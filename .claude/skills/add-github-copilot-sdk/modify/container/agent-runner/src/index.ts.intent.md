# Intent: container/agent-runner/src/index.ts modifications

## What changed
Complete rewrite of the agent runner from Claude Agent SDK (`ClaudeClient`/`Session`) to GitHub Copilot SDK (`CopilotClient`/`CopilotSession`). Same overall architecture: read JSON input from stdin, create/resume a session, send prompt, stream results via stdout sentinels, archive conversation.

## Key sections

### Imports
- Replaced: `ClaudeClient`, `Session` from `@anthropic-ai/claude-agent-sdk`
- Added: `CopilotClient`, `CopilotSession`, `SessionConfig`, `ResumeSessionConfig`, `SessionEvent`, `SessionHooks`, `PreToolUseHookInput`, `approveAll` from `@github/copilot-sdk`

### Authentication
- Replaced: `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` extraction
- Added: `githubToken` extracted from `secrets.GITHUB_TOKEN || secrets.GH_TOKEN`
- Client construction: `new CopilotClient({ githubToken })` instead of `new ClaudeClient(apiKey)`

### Session lifecycle
- `client.createSession(config)` / `client.resumeSession(config)` instead of `client.newSession()` / `client.resume()`
- `session.sendAndWait(prompt, { timeout: 600_000 })` instead of `session.send(prompt)`
- `client.stop()` / `client.forceStop()` for cleanup instead of `session.destroy()`

### Session config
- `configDir: '/home/node/.copilot'` for session persistence
- `skillDirectories` discovered from `/workspace/skills/`
- `systemMessage: { content: systemPrompt, mode: 'append' }` instead of `systemPrompt` string
- `onPermissionRequest: approveAll` for headless operation
- MCP servers configured with `tools: ['*']` wildcard

### Secret stripping (onPreToolUse hook)
- `ALWAYS_STRIP_VARS = ['COPILOT_SDK_AUTH_TOKEN']`
- Dynamic: `Object.keys(containerInput.secrets)` computed at runtime
- Injects `unset` commands before bash tool calls to prevent secret leakage

### Session events
- `session.compaction_start` for context window compaction logging
- `session.error` for error handling
- `onSessionEnd` hook for crash-safe conversation archiving

### Shutdown
- `client.stop()` returns `stopErrors` array (logged as warnings)
- `client.forceStop()` as fallback via `Promise.race` with 5s timeout

## Invariants
- Stdin JSON format unchanged (`ContainerInput` type)
- Stdout sentinel protocol unchanged (`OUTPUT_START_MARKER` / `OUTPUT_END_MARKER`)
- IPC file watcher pattern unchanged (watches `/workspace/ipc/input/`)
- MCP server setup unchanged (tools served via `@modelcontextprotocol/sdk`)
- System prompt construction unchanged (reads CLAUDE.md files, injects group context)
- Conversation archiving format unchanged (markdown in `/workspace/group/conversations/`)

## Must-keep
- `ContainerInput` / `ContainerOutput` / `ContainerResultOutput` type definitions
- `OUTPUT_START_MARKER` / `OUTPUT_END_MARKER` sentinel constants
- `buildSystemPrompt()` function (reads CLAUDE.md, injects context)
- `archiveConversation()` function
- `startIpcInputWatcher()` function (file-based follow-up messages)
- IPC MCP server (tools for scheduling, messaging, registration)
- The stdin → process → stdout pipeline architecture
