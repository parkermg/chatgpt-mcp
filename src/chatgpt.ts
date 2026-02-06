// ChatGPT interaction logic — merges gpt-bridge + chatgpt-desktop-mcp

import {
  SessionState,
  AskResult,
  SimpleResult,
  SELECTORS,
  CONFIG,
} from './types.js';
import {
  getPage,
  navigateTo,
  findElement,
  elementExists,
  typeText,
  clickElement,
  wait,
  saveStorageState,
  isBrowserRunning,
  launchBrowser,
} from './browser.js';
import { fibonacciBackoff, sleep } from './utils/backoff.js';

// ============================================
// Global state
// ============================================

let sessionState: SessionState = {
  isLoggedIn: false,
  currentModel: null,
  conversationId: null,
  currentProjectUrl: null,
};

let sessionInitialized = false;

// ============================================
// Session management
// ============================================

/**
 * Auto-start session on first call. Not exposed as a tool.
 */
export async function ensureSession(): Promise<void> {
  if (sessionInitialized && isBrowserRunning()) {
    return;
  }

  await launchBrowser();
  const success = await navigateTo(CONFIG.chatgptUrl);
  if (!success) {
    throw new Error('Failed to navigate to ChatGPT');
  }

  await wait(2000);

  const isLoggedIn = await checkLoginStatus();
  sessionState.isLoggedIn = isLoggedIn;
  sessionInitialized = true;

  if (!isLoggedIn) {
    throw new Error(
      'Not logged in to ChatGPT. Please log in manually in the browser window, then retry.'
    );
  }

  await saveStorageState();
}

/**
 * Check if user is logged in to ChatGPT
 */
async function checkLoginStatus(): Promise<boolean> {
  const hasLoggedInIndicator = await elementExists(SELECTORS.loggedInIndicator);
  const hasLoginPrompt = await elementExists(SELECTORS.loginPrompt);
  const hasPromptArea = await elementExists(SELECTORS.promptTextarea);

  return (hasLoggedInIndicator || hasPromptArea) && !hasLoginPrompt;
}

// ============================================
// Response extraction (from gpt-bridge — most valuable code)
// ============================================

/**
 * Get the latest assistant response text from the page.
 * Uses 5-strategy extraction with thinking-content filtering.
 */
async function getLatestResponseText(): Promise<string | null> {
  try {
    const page = await getPage();

    const text = await page.evaluate(() => {
      // Helper to clean text by removing UI chrome from ChatGPT
      const cleanText = (text: string): string => {
        let cleaned = text;

        const phrasesToRemove = [
          'ChatGPT said:',
          'ChatGPT said',
          'Pro thinking',
          'Answer now',
          'Extended thinking',
          'Show thinking',
          'Hide thinking',
          'Reasoning',
          'Thinking...',
          'Thinking\u2026',
          'Thinking',
          '\u2022 ',
        ];

        for (const phrase of phrasesToRemove) {
          while (cleaned.includes(phrase)) {
            cleaned = cleaned.replace(phrase, ' ');
          }
        }

        cleaned = cleaned.replace(/Pro\s+thinking\s*\u2022?\s*/gi, '');
        cleaned = cleaned.replace(/\d+\s*(seconds?|secs?|s)\s*/gi, '');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
      };

      // Helper to extract clean text from an element, excluding UI chrome
      const getText = (el: Element | null): string | null => {
        if (!el) return null;

        const clone = el.cloneNode(true) as Element;

        const chromeSelectors = [
          '[class*="thinking"]',
          '[class*="reasoning"]',
          '[data-testid*="thinking"]',
          'button',
          '[role="button"]',
          '[class*="actions"]',
          '[class*="toolbar"]',
          '[class*="copy"]',
          '[aria-label*="Copy"]',
          '[aria-label*="Regenerate"]',
          '[aria-label*="Edit"]',
        ];

        for (const selector of chromeSelectors) {
          clone.querySelectorAll(selector).forEach(e => e.remove());
        }

        const markdown = clone.querySelector('.markdown, .prose, [class*="markdown"]');
        if (markdown) {
          return cleanText(markdown.textContent?.trim() ?? '');
        }

        const rawText = clone.textContent?.trim() ?? null;
        return rawText ? cleanText(rawText) : null;
      };

      // Helper to check if element is inside a thinking/reasoning container
      const isInsideThinking = (el: Element): boolean => {
        let parent: Element | null = el;
        while (parent) {
          const classes = parent.className?.toLowerCase() || '';
          const testId = parent.getAttribute('data-testid')?.toLowerCase() || '';
          if (classes.includes('thinking') || classes.includes('reasoning') ||
              testId.includes('thinking') || testId.includes('reasoning')) {
            return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };

      // Strategy 1: Markdown/prose content NOT inside thinking containers
      const main = document.querySelector('main');
      if (main) {
        const markdowns = main.querySelectorAll('.markdown, .prose, [class*="markdown"]');
        const nonThinkingMarkdowns = Array.from(markdowns).filter(m => !isInsideThinking(m));
        if (nonThinkingMarkdowns.length > 0) {
          const lastMarkdown = nonThinkingMarkdowns[nonThinkingMarkdowns.length - 1];
          const text = lastMarkdown.textContent?.trim();
          if (text) return cleanText(text);
        }
        if (markdowns.length > 0) {
          const lastMarkdown = markdowns[markdowns.length - 1];
          const text = lastMarkdown.textContent?.trim();
          if (text) return cleanText(text);
        }
      }

      // Strategy 2: data-message-author-role="assistant"
      const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (assistantMessages.length > 0) {
        const lastMsg = assistantMessages[assistantMessages.length - 1];
        const text = getText(lastMsg);
        if (text) return text;
      }

      // Strategy 3: Article elements (ChatGPT uses articles for turns)
      const articles = document.querySelectorAll('article');
      if (articles.length > 0) {
        const lastArticle = articles[articles.length - 1];
        const text = getText(lastArticle);
        if (text) return text;
      }

      // Strategy 4: Conversation turn containers
      const turnSelectors = [
        '[data-testid*="conversation-turn"]',
        '[class*="conversation-turn"]',
        '.agent-turn',
        '[class*="agent-turn"]',
      ];

      for (const selector of turnSelectors) {
        const turns = document.querySelectorAll(selector);
        if (turns.length > 0) {
          const lastTurn = turns[turns.length - 1];
          const text = getText(lastTurn);
          if (text) return text;
        }
      }

      // Strategy 5: Last resort — response/message containers
      const responseContainers = document.querySelectorAll('[class*="response"], [class*="message"]');
      if (responseContainers.length > 0) {
        const last = responseContainers[responseContainers.length - 1];
        const text = getText(last);
        if (text) return text;
      }

      return null;
    });

    return text;
  } catch (error) {
    console.error('Failed to get response text:', error);
    return null;
  }
}

// ============================================
// Generation completion detection
// ============================================

/**
 * Check if generation is complete using multi-indicator + content stability.
 * Returns high-confidence boolean.
 */
async function isGenerationComplete(
  lastContentLength: number,
  stableCount: number,
): Promise<{ complete: boolean; contentLength: number; newStableCount: number }> {
  const page = await getPage();

  const indicators = await page.evaluate(() => {
    const stopBtn = document.querySelector('[data-testid="stop-button"]') ||
                    document.querySelector('button[aria-label*="Stop"]') ||
                    document.querySelector('button[aria-label*="stop"]');

    const regenBtn = document.querySelector('button[aria-label*="Regenerate"]') ||
                     document.querySelector('button[aria-label*="Retry"]') ||
                     document.querySelector('[data-testid="regenerate-button"]');

    const copyBtns = document.querySelectorAll('button[aria-label*="Copy"]');

    const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                    document.querySelector('button[data-testid="composer-send-button"]');
    const sendEnabled = sendBtn && !sendBtn.hasAttribute('disabled');

    const isStreaming = document.querySelector('[data-is-streaming="true"]') !== null;

    return {
      hasStopButton: !!stopBtn,
      hasRegenButton: !!regenBtn,
      hasCopyButton: copyBtns.length > 0,
      sendEnabled: !!sendEnabled,
      isStreaming,
    };
  });

  const currentText = await getLatestResponseText();
  const currentLength = currentText?.length ?? 0;

  // Still actively generating
  if (indicators.hasStopButton || indicators.isStreaming) {
    return { complete: false, contentLength: currentLength, newStableCount: 0 };
  }

  // Check content stability
  let newStableCount = stableCount;
  if (currentLength > 0 && currentLength === lastContentLength) {
    newStableCount++;
  } else {
    newStableCount = 0;
  }

  const hasCompletionButton = indicators.hasRegenButton || indicators.hasCopyButton;

  // High confidence: stop absent AND send enabled AND (completion button OR content stable)
  const highConfidence =
    !indicators.hasStopButton &&
    indicators.sendEnabled &&
    (hasCompletionButton || newStableCount >= CONFIG.stableThreshold);

  return {
    complete: highConfidence,
    contentLength: currentLength,
    newStableCount,
  };
}

// ============================================
// Prompt sending
// ============================================

/**
 * Send a prompt to ChatGPT by typing into textarea and clicking send
 */
async function sendPromptText(prompt: string): Promise<void> {
  const typed = await typeText(SELECTORS.promptTextarea, prompt);
  if (!typed) {
    throw new Error('Failed to find prompt textarea. The ChatGPT UI may have changed.');
  }

  await wait(500);

  const sent = await clickElement(SELECTORS.sendButton);
  if (!sent) {
    const page = await getPage();
    await page.keyboard.press('Enter');
  }

  await wait(1000);

  // Extract conversation ID from URL
  const page = await getPage();
  const url = page.url();
  const match = url.match(/\/c\/([a-f0-9-]+)/);
  if (match) {
    sessionState.conversationId = match[1];
  }
}

// ============================================
// Blocking poll loop
// ============================================

/**
 * Poll until generation is complete or deadline is reached.
 * Returns the response text.
 */
async function pollUntilComplete(
  timeoutMinutes: number,
): Promise<{ response: string; pollCount: number; elapsedSeconds: number }> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMinutes * 60 * 1000;
  let pollCount = 0;
  let lastContentLength = 0;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const waitMs = fibonacciBackoff(pollCount);
    await sleep(waitMs);
    pollCount++;

    const result = await isGenerationComplete(lastContentLength, stableCount);
    lastContentLength = result.contentLength;
    stableCount = result.newStableCount;

    if (result.complete) {
      const response = await getLatestResponseText();
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      return {
        response: response ?? '',
        pollCount,
        elapsedSeconds,
      };
    }
  }

  // Timeout
  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  throw new Error(
    `Timeout after ${timeoutMinutes} minutes (${elapsedSeconds}s). Response may still be generating.`
  );
}

// ============================================
// Model selection (from gpt-bridge — robust dropdown discovery)
// ============================================

/**
 * Select a model/mode in ChatGPT. Handles dropdown discovery with dynamic option scanning.
 */
export async function selectModel(modelName: string): Promise<string | null> {
  const page = await getPage();

  // Check current model
  const currentModel = await page.evaluate(() => {
    const selectors = [
      'button[aria-label="Model selector"]',
      'button[aria-haspopup="menu"]',
      '[data-testid="model-selector"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        const text = btn.textContent?.trim();
        if (text && (text.includes('GPT') || text.includes('Pro') || text.includes('4o'))) {
          return text;
        }
      }
    }
    return null;
  });

  if (currentModel?.toLowerCase().includes(modelName.toLowerCase())) {
    sessionState.currentModel = currentModel;
    return currentModel;
  }

  // Click model selector button
  const clicked = await page.evaluate(() => {
    const modelSelectorBtn = document.querySelector('button[aria-label="Model selector"]') as HTMLElement;
    if (modelSelectorBtn) {
      modelSelectorBtn.click();
      return true;
    }
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim() || '';
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < 300 &&
          (text.includes('GPT') || text.includes('Pro') || text.includes('4o') || text.includes('ChatGPT'))) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    throw new Error('Failed to find model selector button.');
  }

  await wait(2000);

  // Find and click the target model in the dropdown
  const result = await page.evaluate((targetInput) => {
    const targetLower = targetInput.toLowerCase().trim();

    const getOptionText = (el: Element): string => {
      const text = el.textContent?.trim() || '';
      const firstLine = text.split('\n')[0].trim();
      const mainText = firstLine.split('Decides')[0].split('Answers')[0].split('Thinks')[0].split('Research')[0].trim();
      return mainText.length > 0 && mainText.length < 40 ? mainText : firstLine.substring(0, 40);
    };

    // Find dropdown container
    const containerSelectors = [
      '[data-radix-popper-content-wrapper]',
      '[role="menu"]',
      '[role="listbox"]',
      '[data-state="open"]',
      '[class*="popover"]',
      '[class*="dropdown"]',
      '[class*="menu"]',
    ];

    let dropdownContainer: Element | null = null;
    for (const selector of containerSelectors) {
      const containers = document.querySelectorAll(selector);
      for (const container of containers) {
        const rect = (container as HTMLElement).getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          dropdownContainer = container;
          break;
        }
      }
      if (dropdownContainer) break;
    }

    // Fallback: positioned overlay
    if (!dropdownContainer) {
      const allDivs = document.querySelectorAll('div');
      for (const el of allDivs) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const isPositioned = style.position === 'fixed' || style.position === 'absolute';
        const hasReasonableSize = rect.width > 100 && rect.height > 100 && rect.width < 600 && rect.height < 700;
        const notFullScreen = rect.width < window.innerWidth * 0.8;

        if (isPositioned && hasReasonableSize && notFullScreen) {
          const text = el.textContent || '';
          const hasMenuIndicators =
            text.includes('Auto') || text.includes('Instant') || text.includes('Thinking') ||
            text.includes('Pro') || text.includes('Legacy') || text.includes('GPT') ||
            el.querySelector('[role="menuitem"], [role="option"], button, [data-radix]');
          if (hasMenuIndicators) {
            dropdownContainer = el;
            break;
          }
        }
      }
    }

    if (!dropdownContainer) {
      return { success: false, selected: null, available: [] as string[] };
    }

    // Find menu items
    const candidateSelectors = [
      '[role="menuitem"]',
      '[role="option"]',
      '[data-radix-collection-item]',
      'button',
      'a',
      'div[tabindex]',
      'div[class*="item"]',
      'div[class*="option"]',
    ];

    const availableOptions: Array<{ text: string; element: Element }> = [];
    const seenTexts = new Set<string>();
    const modePatterns = /^(Auto|Instant|Thinking|Pro|Legacy|GPT|ChatGPT)/i;

    for (const selector of candidateSelectors) {
      const items = dropdownContainer.querySelectorAll(selector);
      for (const item of items) {
        const rect = (item as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.height < 20 || rect.height > 100) continue;
        const text = getOptionText(item);
        if (text.length < 2 || text.length > 50 || seenTexts.has(text)) continue;
        const skipPatterns = ['how long', 'right away', 'longer for', 'Close', 'Back'];
        if (skipPatterns.some(p => text.toLowerCase().includes(p.toLowerCase()))) continue;
        if (modePatterns.test(text)) {
          seenTexts.add(text);
          availableOptions.push({ text, element: item });
        }
      }
    }

    // Match: exact → starts with → contains
    for (const opt of availableOptions) {
      if (opt.text.toLowerCase() === targetLower) {
        (opt.element as HTMLElement).click();
        return { success: true, selected: opt.text, available: availableOptions.map(o => o.text) };
      }
    }
    for (const opt of availableOptions) {
      if (opt.text.toLowerCase().startsWith(targetLower)) {
        (opt.element as HTMLElement).click();
        return { success: true, selected: opt.text, available: availableOptions.map(o => o.text) };
      }
    }
    for (const opt of availableOptions) {
      if (opt.text.toLowerCase().includes(targetLower)) {
        (opt.element as HTMLElement).click();
        return { success: true, selected: opt.text, available: availableOptions.map(o => o.text) };
      }
    }

    return { success: false, selected: null, available: availableOptions.map(o => o.text) };
  }, modelName);

  if (!result.success) {
    await page.keyboard.press('Escape');
    await wait(300);
    const availableStr = result.available.length > 0 ? result.available.join(', ') : 'none detected';
    throw new Error(`"${modelName}" not found. Available options: ${availableStr}`);
  }

  await wait(500);
  sessionState.currentModel = result.selected || modelName;
  return result.selected || modelName;
}

// ============================================
// Project selection (from gpt-bridge)
// ============================================

/**
 * Select a project by name. Finds /g/g-p-* links and navigates.
 */
export async function selectProject(projectName: string): Promise<SimpleResult> {
  try {
    await ensureSession();
    const page = await getPage();

    const projectUrl = await page.evaluate((name) => {
      const projectLinks = document.querySelectorAll('a[href*="/g/g-p-"]');

      // Exact match first
      for (const el of projectLinks) {
        const href = el.getAttribute('href') || '';
        if (href.includes('/project')) {
          const linkText = el.textContent?.trim().toLowerCase();
          if (linkText === name.toLowerCase()) return href;
        }
      }

      // Partial match
      for (const el of projectLinks) {
        const href = el.getAttribute('href') || '';
        if (href.includes('/project')) {
          const linkText = el.textContent?.trim().toLowerCase();
          if (linkText?.includes(name.toLowerCase())) return href;
        }
      }

      return null;
    }, projectName);

    if (!projectUrl) {
      return {
        success: false,
        message: `Project "${projectName}" not found in sidebar.`,
      };
    }

    const fullUrl = projectUrl.startsWith('http') ? projectUrl : `https://chatgpt.com${projectUrl}`;
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    await wait(2000);

    sessionState.currentProjectUrl = fullUrl;
    sessionState.conversationId = null;

    return {
      success: true,
      message: `Selected project: ${projectName}. New conversations will stay within this project.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to select project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================
// New conversation
// ============================================

/**
 * Start a new conversation. Stays within current project if set.
 */
export async function newConversation(): Promise<SimpleResult> {
  try {
    await ensureSession();

    const targetUrl = sessionState.currentProjectUrl || CONFIG.chatgptUrl;
    await navigateTo(targetUrl);
    await wait(1500);

    sessionState.conversationId = null;

    const inProject = sessionState.currentProjectUrl ? ' within current project' : '';
    return {
      success: true,
      message: `New conversation started${inProject}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to start new conversation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================
// Core blocking tools
// ============================================

/**
 * blockingAsk — the primary tool. Send prompt, poll until complete, return response.
 */
export async function blockingAsk(
  prompt: string,
  model?: string,
  project?: string,
  timeoutMinutes = 60,
): Promise<AskResult> {
  try {
    await ensureSession();

    // Navigate to project if specified and different from current
    if (project) {
      const page = await getPage();
      const currentUrl = page.url();
      const needsProjectSwitch = !sessionState.currentProjectUrl ||
        !currentUrl.includes('/g/g-p-');

      if (needsProjectSwitch) {
        const result = await selectProject(project);
        if (!result.success) {
          return {
            response: '',
            elapsed_seconds: 0,
            model: null,
            chat_id: null,
            poll_count: 0,
            error: result.message,
          };
        }
      }
    }

    // Switch model if specified
    if (model) {
      try {
        await selectModel(model);
      } catch (error) {
        return {
          response: '',
          elapsed_seconds: 0,
          model: null,
          chat_id: null,
          poll_count: 0,
          error: `Model selection failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Send prompt
    await sendPromptText(prompt);

    // Poll until complete
    const result = await pollUntilComplete(timeoutMinutes);

    return {
      response: result.response,
      elapsed_seconds: result.elapsedSeconds,
      model: sessionState.currentModel,
      chat_id: sessionState.conversationId,
      poll_count: result.pollCount,
    };
  } catch (error) {
    return {
      response: '',
      elapsed_seconds: 0,
      model: null,
      chat_id: null,
      poll_count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * blockingReply — same polling loop but no project/model switching.
 * Operates in the current conversation.
 */
export async function blockingReply(
  prompt: string,
  timeoutMinutes = 60,
): Promise<AskResult> {
  try {
    await ensureSession();

    if (!sessionState.conversationId) {
      // Still allow reply even without tracked ID — user might have manually navigated
    }

    await sendPromptText(prompt);

    const result = await pollUntilComplete(timeoutMinutes);

    return {
      response: result.response,
      elapsed_seconds: result.elapsedSeconds,
      model: sessionState.currentModel,
      chat_id: sessionState.conversationId,
      poll_count: result.pollCount,
    };
  } catch (error) {
    return {
      response: '',
      elapsed_seconds: 0,
      model: null,
      chat_id: null,
      poll_count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================
// File upload
// ============================================

/**
 * Upload files and optionally send a prompt, then poll for response.
 */
export async function uploadFiles(
  filePaths: string[],
  prompt?: string,
  timeoutMinutes = 60,
): Promise<AskResult> {
  try {
    await ensureSession();
    const page = await getPage();

    // Click attach button
    const attachClicked = await clickElement(SELECTORS.attachButton);
    if (!attachClicked) {
      throw new Error('Failed to find attach/upload button.');
    }

    // Wait for file chooser and set files
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
    ]);
    await fileChooser.setFiles(filePaths);

    // Wait for upload indicators to appear and settle
    await wait(3000);

    // If prompt provided, type it
    if (prompt) {
      const typed = await typeText(SELECTORS.promptTextarea, prompt);
      if (!typed) {
        throw new Error('Failed to type prompt after file upload.');
      }
    }

    // Send
    await wait(500);
    const sent = await clickElement(SELECTORS.sendButton);
    if (!sent) {
      await page.keyboard.press('Enter');
    }

    await wait(1000);

    // Extract conversation ID
    const url = page.url();
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    if (match) {
      sessionState.conversationId = match[1];
    }

    // Poll until complete
    const result = await pollUntilComplete(timeoutMinutes);

    return {
      response: result.response,
      elapsed_seconds: result.elapsedSeconds,
      model: sessionState.currentModel,
      chat_id: sessionState.conversationId,
      poll_count: result.pollCount,
    };
  } catch (error) {
    return {
      response: '',
      elapsed_seconds: 0,
      model: null,
      chat_id: null,
      poll_count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
