// Browser management for chatgpt-mcp

import { chromium, BrowserContext, Page } from 'playwright';
import { CONFIG } from './types.js';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

let context: BrowserContext | null = null;
let page: Page | null = null;

async function ensureUserDataDir(): Promise<void> {
  if (!existsSync(CONFIG.userDataDir)) {
    await mkdir(CONFIG.userDataDir, { recursive: true });
  }
}

/**
 * Launch browser with a persistent user data directory.
 *
 * Uses launchPersistentContext() which maintains the full browser profile
 * on disk (cookies, localStorage, IndexedDB, browser fingerprint).
 * This means:
 * - Login persists across MCP server restarts
 * - Cloudflare bot detection is less likely (consistent fingerprint)
 * - No separate storageState save/load needed
 */
export async function launchBrowser(): Promise<Page> {
  if (page && !page.isClosed()) {
    return page;
  }

  await ensureUserDataDir();

  context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  // Use the first page if one already exists, otherwise create one
  const pages = context.pages();
  page = pages.length > 0 ? pages[0] : await context.newPage();

  return page;
}

/**
 * Save browser storage state — with persistent context this is mostly a no-op
 * since the profile is on disk, but we call it for extra safety.
 */
export async function saveStorageState(): Promise<void> {
  // Persistent context auto-saves to userDataDir, nothing to do
}

/**
 * Get the current page, launching browser if needed
 */
export async function getPage(): Promise<Page> {
  if (!page || page.isClosed()) {
    return launchBrowser();
  }
  return page;
}

/**
 * Check if browser is running
 */
export function isBrowserRunning(): boolean {
  return page !== null && !page.isClosed();
}

/**
 * Close the browser
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
  }

  page = null;
  context = null;
}

/**
 * Navigate to a URL with error handling
 */
export async function navigateTo(url: string): Promise<boolean> {
  const p = await getPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.defaultTimeout });
    return true;
  } catch (error) {
    console.error(`Failed to navigate to ${url}:`, error);
    return false;
  }
}

/**
 * Find an element using multiple selector fallbacks
 */
export async function findElement(selectors: readonly string[], timeout = 5000): Promise<any | null> {
  const p = await getPage();

  for (const selector of selectors) {
    try {
      const element = await p.waitForSelector(selector, { timeout, state: 'visible' });
      if (element) {
        return element;
      }
    } catch {
      // Try next selector
    }
  }

  return null;
}

/**
 * Check if any selector matches an element on the page
 */
export async function elementExists(selectors: readonly string[]): Promise<boolean> {
  const p = await getPage();

  for (const selector of selectors) {
    try {
      const element = await p.$(selector);
      if (element) {
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  return false;
}

/**
 * Type text into an element found by selectors
 */
export async function typeText(selectors: readonly string[], text: string): Promise<boolean> {
  const element = await findElement(selectors);
  if (!element) {
    return false;
  }

  await element.click();
  await element.fill('');

  for (const char of text) {
    await element.type(char, { delay: CONFIG.typingDelay });
  }

  return true;
}

/**
 * Click an element found by selectors
 */
export async function clickElement(selectors: readonly string[]): Promise<boolean> {
  const element = await findElement(selectors);
  if (!element) {
    return false;
  }

  await element.click();
  return true;
}

/**
 * Get text content from an element
 */
export async function getElementText(selectors: readonly string[]): Promise<string | null> {
  const element = await findElement(selectors, 10000);
  if (!element) {
    return null;
  }

  return element.innerText();
}

/**
 * Wait for a specified duration
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute JavaScript on the page
 */
export async function evaluate<T>(fn: () => T): Promise<T> {
  const p = await getPage();
  return p.evaluate(fn);
}
