# CLAUDE.md — chatgpt-mcp

## What this project is

An MCP (Model Context Protocol) server that automates ChatGPT's web UI via Playwright, providing blocking `ask(prompt) → response` tools. It exists because GPT-5.2 Pro is only available through the ChatGPT web interface (not via API on subscription plans), and we need it accessible as an MCP tool alongside Codex, Gemini, and Claude in a multi-model orchestration setup.

## Project structure

```
src/
├── index.ts        # MCP server entry point — registers 5 tools, handles shutdown
├── browser.ts      # Playwright session management — launch, navigate, find elements, persist cookies
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

## How it works

1. **Auto-start**: First tool call launches Chromium, navigates to chatgpt.com, checks login status
2. **Cookies**: Stored at `~/.chatgpt-mcp/user-data/state.json` for persistent sessions
3. **Sending**: Types into `#prompt-textarea`, clicks send button (multi-selector fallback)
4. **Polling**: Fibonacci backoff checks DOM indicators + content stability until high-confidence complete
5. **Extraction**: 5-strategy cascade to find response text, filtering out thinking/reasoning UI chrome

## Critical code sections

- **Response extraction** (`chatgpt.ts:getLatestResponseText`): The most complex and valuable function. Uses 5 strategies in cascade because ChatGPT's DOM changes frequently. Filters out thinking/reasoning containers and UI chrome. If ChatGPT's UI changes break response reading, this is where to fix it.

- **Completion detection** (`chatgpt.ts:isGenerationComplete`): Multi-indicator approach — checks stop button, streaming attribute, regen/copy buttons, send-enabled state, and content stability (3 consecutive checks with same length). High confidence = stop absent AND send enabled AND (completion button OR content stable).

- **Model selection** (`chatgpt.ts:selectModel`): Clicks model selector button, discovers dropdown container via multiple strategies (radix poppers, role=menu, positioned overlays), scans for options matching mode patterns, then matches by exact → startsWith → contains.

- **DOM selectors** (`types.ts:SELECTORS`): Arrays of fallback selectors for each UI element. When ChatGPT's HTML changes, update these first.

## Ancestry

This codebase merges two prototypes:
- **gpt-bridge** (`/Users/parker/claude/mcp-servers/gpt-bridge/`) — Playwright-based, contributed: response extraction, model selection, project management, browser module
- **chatgpt-desktop-mcp** (`/Users/parker/.claude/mcp-servers/chatgpt-desktop-mcp/`) — AppleScript-based, contributed: blocking ask pattern, Fibonacci backoff, McpServer.registerTool + Zod pattern

Both predecessors are superseded by this project.

## Common maintenance tasks

- **ChatGPT UI changed and responses aren't extracted**: Update `SELECTORS` in `types.ts` and/or the 5-strategy cascade in `getLatestResponseText`
- **New model/mode added**: `selectModel` auto-discovers options dynamically, should work without changes
- **Want to add a new tool**: Add to `index.ts` using the `server.registerTool()` pattern with Zod schema, implement in `chatgpt.ts`
- **Timeout issues**: Adjust `CONFIG.stableThreshold` (currently 3) or default `timeoutMinutes` (currently 60)

## Tech stack

- TypeScript (ES2022, Node16 modules, strict)
- Playwright (Chromium, headed mode)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Zod (input validation)
