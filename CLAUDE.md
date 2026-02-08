# CLAUDE.md — chatgpt-mcp

## What this project is

An MCP (Model Context Protocol) server that automates ChatGPT's web UI via Playwright, providing blocking `ask(prompt) → response` tools. It exists because GPT-5.2 Pro is only available through the ChatGPT web interface (not via API on subscription plans), and we need it accessible as an MCP tool alongside Codex, Gemini, and Claude in a multi-model orchestration setup.

## Project structure

```
src/
├── index.ts        # MCP server entry point — registers 5 tools, handles shutdown
├── browser.ts      # Playwright persistent context — launchPersistentContext, navigate, find elements
├── chatgpt.ts      # Core logic — ensureSession, blockingAsk, blockingReply, uploadFiles,
│                   #   selectModel, selectProject, newConversation, getLatestResponseText,
│                   #   isGenerationComplete, pollUntilComplete
├── types.ts        # DOM selectors (multi-fallback arrays), CONFIG constants, result interfaces
└── utils/
    └── backoff.ts  # Fibonacci backoff (2,3,5,8,13,21,30s) + sleep utility
```

## Build and run

```bash
npm run build    # tsc → dist/
node dist/index.js  # starts MCP server on stdio
```

Configured in `~/.claude.json` under `mcpServers.chatgpt`.

## How it works

1. **Auto-start**: First tool call launches Chromium via `launchPersistentContext()`, navigates to chatgpt.com, checks login (with 3 retries at 3s intervals), then auto-selects the default project
2. **Persistent profile**: Full browser profile stored at `~/.chatgpt-mcp/user-data/` (cookies, localStorage, IndexedDB, fingerprint). Login persists across MCP server restarts. No separate storageState save/load needed.
3. **Default project**: All new chats go to the "claude" project in ChatGPT (configured in `CONFIG.defaultProject` in `types.ts`). This keeps orchestrator conversations organized and separate from manual ChatGPT use.
4. **Sending**: Types into `#prompt-textarea`, clicks send button (with Enter key fallback)
5. **Polling**: Fibonacci backoff (2,3,5,8,13,21,30s) checks DOM indicators + content stability
6. **Extraction**: 4-strategy cascade using `innerText` on last conversation turn, cleaning UI chrome phrases

## Critical code sections

- **Response extraction** (`chatgpt.ts:getLatestResponseText`): Uses `HTMLElement.innerText` on the last `[data-testid^="conversation-turn-"]` element (which respects CSS visibility). Cleans UI chrome phrases like "ChatGPT said:", "Pro thinking", timing indicators, etc. Falls back to clone-strip-textContent, markdown/prose selectors, and `data-message-author-role="assistant"`.

- **Completion detection** (`chatgpt.ts:isGenerationComplete`): Primary signal is `copy-turn-action-button` inside the LAST conversation turn — this only appears when that turn's generation is truly complete. Fallback is content stability for 10+ consecutive checks (~3+ minutes) AND not in thinking state. **Important bugs fixed:**
  - `stop-button` persists permanently in the DOM — DO NOT use for completion detection
  - `[class*="streaming"]` matches unrelated elements — DO NOT use
  - Content stability alone at low thresholds causes false positives during GPT-5.2 Pro's thinking phase (thinking summary text appears stable before the actual response)

- **Model selection** (`chatgpt.ts:selectModel`): Clicks model selector button, discovers dropdown container via multiple strategies (radix poppers, role=menu, positioned overlays), scans for options matching mode patterns, then matches by exact → startsWith → contains.

- **DOM selectors** (`types.ts:SELECTORS`): Arrays of fallback selectors for each UI element. When ChatGPT's HTML changes, update these first.

## Known behaviors and gotchas

- **GPT-5.2 Pro thinking time**: Simple prompts take 30-140s. Web search prompts can take 10-16+ minutes (~950s observed). Always use `timeout_minutes: 30` for web search queries.
- **Cloudflare bot detection**: Using `launchPersistentContext()` with a stable user agent and `--disable-blink-features=AutomationControlled` minimizes this. Avoid spawning multiple browser instances.
- **Login false negatives**: The login check retries 3 times because Cloudflare challenges or slow page loads can cause the first check to fail before the page is fully rendered.
- **One browser window**: The MCP server reuses a single persistent browser context. Never spawn additional windows for testing — it triggers Cloudflare and fragments state.
- **MCP server restarts**: After `npm run build`, the MCP server must be restarted (restart Claude Code) to pick up changes. The browser state persists across restarts via the user data directory.

## Ancestry

This codebase merges two prototypes:
- **gpt-bridge** (`/Users/parker/claude/mcp-servers/gpt-bridge/`) — Playwright-based, contributed: response extraction, model selection, project management, browser module
- **chatgpt-desktop-mcp** (`/Users/parker/.claude/mcp-servers/chatgpt-desktop-mcp/`) — AppleScript-based, contributed: blocking ask pattern, Fibonacci backoff, McpServer.registerTool + Zod pattern

Both predecessors are superseded by this project.

## Common maintenance tasks

- **ChatGPT UI changed and responses aren't extracted**: Update selectors in `getLatestResponseText` and/or `SELECTORS` in `types.ts`. The `innerText` approach is resilient to most layout changes but `conversation-turn-*` testids are critical.
- **Completion detection broken**: Check if `copy-turn-action-button` still appears after generation. If ChatGPT changes this testid, update `isGenerationComplete`. The fallback (10 stable checks) will still work but is very slow.
- **New model/mode added**: `selectModel` auto-discovers options dynamically, should work without changes.
- **Want to add a new tool**: Add to `index.ts` using the `server.registerTool()` pattern with Zod schema, implement in `chatgpt.ts`.
- **Timeout issues**: Adjust `FALLBACK_STABLE_THRESHOLD` in `isGenerationComplete` (currently 10) or default `timeoutMinutes` (currently 60).
- **Reset browser state**: Delete `~/.chatgpt-mcp/user-data/` and restart. You'll need to log in again.

## Tech stack

- TypeScript (ES2022, Node16 modules, strict)
- Playwright (Chromium, headed mode, persistent context)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Zod (input validation)
