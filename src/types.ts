// Types and configuration for chatgpt-mcp

// ============================================
// Result interfaces
// ============================================

export interface AskResult {
  response: string;
  elapsed_seconds: number;
  model: string | null;
  chat_id: string | null;
  poll_count: number;
  error?: string;
}

export interface SimpleResult {
  success: boolean;
  message: string;
  error?: string;
}

export type GenerationStatus = 'idle' | 'generating' | 'complete' | 'error';

export interface SessionState {
  isLoggedIn: boolean;
  currentModel: string | null;
  conversationId: string | null;
  currentProjectUrl: string | null;
}

// ============================================
// ChatGPT DOM selectors — multiple fallbacks for resilience
// ============================================

export const SELECTORS = {
  // Prompt input area
  promptTextarea: [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'textarea[placeholder*="Message"]',
    'div[contenteditable="true"]',
  ],

  // Send button
  sendButton: [
    '[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[data-testid="composer-send-button"]',
  ],

  // Stop generating button (presence = still generating)
  stopButton: [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button:has-text("Stop generating")',
  ],

  // Regenerate button (presence = generation complete)
  regenerateButton: [
    '[data-testid="regenerate-button"]',
    'button:has-text("Regenerate")',
  ],

  // Assistant response messages
  responseContainer: [
    '[data-message-author-role="assistant"]',
    '.agent-turn',
    '[data-testid*="conversation-turn"]:last-child',
  ],

  // Model selector
  modelSelector: [
    '[data-testid="model-selector"]',
    'button:has-text("GPT")',
    '[aria-haspopup="menu"]:has-text("GPT")',
  ],

  // New chat button
  newChatButton: [
    '[data-testid="new-chat-button"]',
    'a[href="/"]',
    'button:has-text("New chat")',
  ],

  // Login indicator (if present, user is logged in)
  loggedInIndicator: [
    '[data-testid="profile-button"]',
    'button[aria-label*="Profile"]',
    'img[alt*="User"]',
  ],

  // Login prompt (if present, user needs to log in)
  loginPrompt: [
    'button:has-text("Log in")',
    'a:has-text("Log in")',
    '[data-testid="login-button"]',
  ],

  // Attach/upload button
  attachButton: [
    '[data-testid="composer-attach-button"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Upload"]',
    'button[aria-label*="attach"]',
  ],
} as const;

// ============================================
// Configuration
// ============================================

export const CONFIG = {
  chatgptUrl: 'https://chatgpt.com',
  userDataDir: `${process.env.HOME}/.chatgpt-mcp/user-data`,
  defaultTimeout: 30000,
  typingDelay: 50,
  pollInterval: 5000,
  stableThreshold: 3, // More conservative than gpt-bridge's 2
  maxWaitTime: 3600000,
} as const;
