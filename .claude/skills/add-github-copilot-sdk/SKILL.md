# Add GitHub Copilot SDK

Switch NanoClaw from Claude Agent SDK to GitHub Copilot SDK backend.

> **Technical Preview**: The Copilot SDK (`@github/copilot-sdk`) is in technical preview.
> The API surface may change between releases. **Always refer to the cloned SDK repository
> at `/Users/josh/git/copilot-sdk/` for the authoritative API** — read the actual source
> files in `nodejs/src/` (especially `types.ts`, `client.ts`, `session.ts`, `index.ts`)
> rather than relying on this document alone. Before making any SDK-related code changes,
> pull the latest and check the current version in `nodejs/package.json`.

## Prerequisites

- GitHub Copilot subscription
- `gh` CLI installed and authenticated (`gh auth login`)
- SDK repo cloned: `git clone git@github.com:github/copilot-sdk.git /Users/josh/git/copilot-sdk`

## Keeping Up to Date

```bash
# Check current version
cd /Users/josh/git/copilot-sdk && git pull && cat nodejs/package.json | grep version

# Update dependency in agent-runner
cd /Users/josh/git/nanoclaw/container/agent-runner
# Edit package.json to match latest version, then:
npm install
```

The version in `container/agent-runner/package.json` should track the latest published release.
Currently: `@github/copilot-sdk@^0.1.25` (SDK source is at `0.1.8`; npm may be ahead).

## What This Changes

- **Agent backend**: Claude Agent SDK -> GitHub Copilot SDK
- **Authentication**: Anthropic API key / OAuth -> GitHub token (`GITHUB_TOKEN` / `GH_TOKEN`)
- **Container**: `claude-code` CLI -> `gh` CLI + Copilot SDK spawns its own CLI
- **Tool definitions**: `tool()` -> `defineTool(name, config)` API
- **Session persistence**: `~/.claude/` -> `~/.copilot/` via `configDir` in SessionConfig
- **Skills loading**: Manual filesystem copy -> `skillDirectories` in SessionConfig

## Files Modified

| File | Change |
|------|--------|
| `container/agent-runner/package.json` | Swap `@anthropic-ai/claude-agent-sdk` for `@github/copilot-sdk` |
| `container/Dockerfile` | Replace `claude-code` with `gh` CLI installation |
| `container/agent-runner/src/index.ts` | Rewrite agent loop using `CopilotClient` / `CopilotSession` |
| `src/container-runner.ts` | Update secrets, mounts (`.claude` -> `.copilot`), skills via bind mount |
| `.claude/skills/x-integration/agent.ts` | Update tool definitions to `defineTool(name, config)` |

## After Running

1. Add GitHub credentials to `.env`:
   ```
   GITHUB_TOKEN=ghp_xxxx
   ```

2. Rebuild container:
   ```bash
   ./container/build.sh
   ```

3. Test locally:
   ```bash
   npm run dev
   ```

---

## SDK API Reference

> Source of truth: `/Users/josh/git/copilot-sdk/nodejs/src/`

### Exports (`index.ts`)

```typescript
// Classes
export { CopilotClient } from "./client.js";
export { CopilotSession, type AssistantMessageEvent } from "./session.js";

// Helpers
export { defineTool, approveAll } from "./types.js";

// Types (key ones)
export type {
  CopilotClientOptions,
  SessionConfig, ResumeSessionConfig,
  SessionEvent, SessionEventType,
  SessionHooks, PreToolUseHookInput, PostToolUseHookInput, SessionEndHookInput,
  Tool, ToolHandler, ToolInvocation, ToolResultObject,
  PermissionHandler, PermissionRequest,
  MCPServerConfig, MCPLocalServerConfig, MCPRemoteServerConfig,
  CustomAgentConfig, InfiniteSessionConfig,
  SystemMessageConfig, SystemMessageAppendConfig, SystemMessageReplaceConfig,
  ModelInfo, ModelBilling, ModelCapabilities, ModelPolicy,
  MessageOptions,
} from "./types.js";
```

### CopilotClient (`client.ts`)

```typescript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient({
  // Authentication (pick one):
  githubToken: 'ghp_xxx',          // Explicit token (preferred for containers)
  // useLoggedInUser: true,         // Use gh CLI auth (default when no token)

  // Process configuration:
  cwd: '/workspace',               // Working directory for CLI process
  logLevel: 'info',                // 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all'

  // SECURITY: Pass minimal env to prevent host secret leakage
  env: {
    HOME: '/home/node',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    LANG: 'C.UTF-8',
  },

  // Advanced:
  // cliPath: '/path/to/cli',      // Custom CLI path (default: bundled @github/copilot)
  // cliArgs: ['--flag'],          // Extra CLI args
  // useStdio: true,               // Stdio transport (default: true)
  // cliUrl: 'localhost:8080',     // Connect to existing CLI server
  // autoStart: true,              // Auto-start on first use (default: true)
  // autoRestart: true,            // Auto-restart on crash (default: true)
});

await client.start();

// Session management
const session = await client.createSession(config);
const session = await client.resumeSession(sessionId, config);
const lastId = await client.getLastSessionId();
const sessions = await client.listSessions({ repository: 'owner/repo' });
await client.deleteSession(sessionId);

// Lifecycle
await client.stop();    // Graceful shutdown (destroys sessions, stops CLI)
await client.dispose(); // Emergency cleanup (no destroy, immediate kill)
```

### SessionConfig (`types.ts`)

```typescript
const config: SessionConfig = {
  // Core
  workingDirectory: '/workspace/group',
  configDir: '/home/node/.copilot',             // Session persistence directory
  model: 'claude-sonnet-4',                     // Optional model override
  reasoningEffort: 'high',                      // 'low' | 'medium' | 'high' | 'xhigh'

  // System prompt
  systemMessage: { mode: 'append', content: 'Extra instructions' },
  // OR: { mode: 'replace', content: 'Full replacement prompt' }

  // Permissions — IMPORTANT: default is deny-all!
  onPermissionRequest: async (request) => ({ kind: 'approved' }),

  // Hooks
  hooks: {
    onPreToolUse:  async (input, { sessionId }) => { /* modify or block tools */ },
    onPostToolUse: async (input, { sessionId }) => { /* inspect results */ },
    onSessionEnd:  async (input, { sessionId }) => { /* cleanup, archive */ },
    onSessionStart: async (input, { sessionId }) => { /* initialization */ },
    onUserPromptSubmitted: async (input, { sessionId }) => { /* intercept prompts */ },
    onErrorOccurred: async (input, { sessionId }) => { /* error handling */ },
  },

  // MCP servers
  mcpServers: {
    myServer: {
      command: 'node',
      args: ['server.js'],
      env: { KEY: 'value' },
      tools: ['*'],                             // Required! Which tools to expose
    },
  },

  // Skills & tools
  skillDirectories: ['/workspace/skills/agent-browser'],
  tools: [myCustomTool],                        // SDK-defined tools via defineTool()
  availableTools: ['Bash', 'Read', 'Write'],    // Whitelist (overrides excludedTools)
  excludedTools: ['WebFetch'],                   // Blacklist

  // Custom agents (subagents)
  customAgents: [{
    name: 'researcher',
    displayName: 'Research Agent',
    prompt: 'You are a research specialist...',
    tools: ['WebFetch', 'Read'],
    mcpServers: { /* agent-specific MCP */ },
  }],

  // Infinite sessions (enabled by default)
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.80,        // Start async compaction at 80%
    bufferExhaustionThreshold: 0.95,            // Block until compaction at 95%
  },
};
```

### ResumeSessionConfig

Same as `SessionConfig` minus `sessionId`. Includes `disableResume?: boolean` to skip the
`session.resume` event (useful for reconnecting without side effects).

### CopilotSession (`session.ts`)

```typescript
// Send and wait for complete response (blocks until idle)
const response = await session.sendAndWait(
  { prompt: 'Hello' },
  600_000                          // Timeout in ms (default: 60_000 — too short for agents!)
);
// response is AssistantMessageEvent | undefined
// response?.data?.content contains the text response

// Fire-and-forget send (for IPC injection during processing)
const messageId = await session.send({ prompt: 'Additional context' });

// Event listeners
session.on('assistant.message', (event) => { /* event.data.content */ });
session.on('session.error', (event) => { /* event.data.message */ });
session.on('session.compaction_start', () => { /* archive before compaction */ });
session.on('session.compaction_complete', (event) => { /* event.data.success */ });
session.on('tool.execution_start', (event) => { /* event.data.toolName */ });
session.on('tool.execution_complete', (event) => { /* event.data.success */ });

// Get conversation history (returns SessionEvent[], not plain messages)
const events = await session.getMessages();

// Cleanup
await session.destroy();
```

### Tool Definition (`types.ts`)

```typescript
import { defineTool, Tool } from '@github/copilot-sdk';
import { z } from 'zod';

const myTool: Tool = defineTool('tool_name', {
  description: 'What this tool does',
  parameters: z.object({
    arg1: z.string().describe('Description'),
    arg2: z.number().optional(),
  }),
  handler: async (args: { arg1: string; arg2?: number }) => {
    // Return a string for simple results
    return 'Result message';
    // OR return a ToolResultObject for rich content:
    // return { content: 'text', isError: false };
  },
});
```

### Session Events (`generated/session-events.ts`)

Key event types (discriminated union on `type` field):

| Event Type | Data Fields | Notes |
|-----------|-------------|-------|
| `user.message` | `content`, `attachments?`, `source?` | User messages |
| `assistant.message` | `messageId`, `content`, `toolRequests?` | Final messages |
| `assistant.message_delta` | `messageId`, `deltaContent` | Streaming chunks (ephemeral) |
| `session.error` | `errorType`, `message`, `stack?` | Errors |
| `session.compaction_start` | `{}` | Compaction beginning |
| `session.compaction_complete` | `success`, `preCompactionTokens?`, ... | Compaction done |
| `session.idle` | `{}` | Session idle (ephemeral) |
| `session.shutdown` | `shutdownType`, `totalPremiumRequests`, `modelMetrics` | Session end |
| `tool.execution_start` | `toolCallId`, `toolName`, `arguments?` | Tool invocation |
| `tool.execution_complete` | `toolCallId`, `success`, `result?`, `error?` | Tool result |
| `subagent.started` | `toolCallId`, `agentName` | Subagent spawn |
| `subagent.completed` | `toolCallId`, `agentName` | Subagent done |

### PreToolUse Hook

```typescript
// Block sensitive paths and strip secrets from bash commands
onPreToolUse: async (input) => {
  const toolName = input.toolName;

  // --- Bash commands: strip secret env vars + block /proc/environ reads ---
  if (toolName === 'Bash' || toolName === 'bash') {
    const args = input.toolArgs as { command?: string };
    if (!args?.command) return;

    // Block commands that try to read /proc/*/environ
    if (/\/proc\/[^/]+\/environ/.test(args.command)) {
      return {
        permissionDecision: 'deny' as const,
        permissionDecisionReason: 'Reading /proc/*/environ is blocked to protect secrets',
      };
    }

    const unsetPrefix = `unset ${secretEnvVars.join(' ')} 2>/dev/null; `;
    return { modifiedArgs: { ...args, command: unsetPrefix + args.command } };
  }

  // --- File read tools: block reads of sensitive paths ---
  if (toolName === 'Read' || toolName === 'read' ||
      toolName === 'ReadFile' || toolName === 'read_file') {
    const args = input.toolArgs as { file_path?: string; path?: string };
    const filePath = args?.file_path || args?.path || '';
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(filePath)) {
        return {
          permissionDecision: 'deny' as const,
          permissionDecisionReason: `Reading ${filePath} is blocked to protect secrets`,
        };
      }
    }
  }

  return;
}
```

---

## Architecture Notes

### How the SDK Works Internally

1. `CopilotClient` spawns a Copilot CLI child process (`@github/copilot`) via stdio
2. Communication is JSON-RPC over stdio between SDK and CLI
3. CLI handles: LLM API calls, built-in tools (Bash, Read, Write, etc.), MCP servers
4. SDK handles: custom tools, permission requests, hooks (dispatched back from CLI via JSON-RPC)

### Authentication Flow

`githubToken` option -> SDK sets `COPILOT_SDK_AUTH_TOKEN` in CLI's env -> CLI uses it for API auth.
The CLI child inherits the parent's `process.env`, so **secrets on process.env leak to bash commands**.
Always pass `githubToken` explicitly and use the `onPreToolUse` hook to strip secrets from bash.

> **Security**: The `env` option on `CopilotClient` controls what environment the CLI subprocess
> inherits. Pass a minimal env (HOME, PATH, NODE_OPTIONS, LANG) instead of letting it inherit
> `process.env`. This limits what `/proc/<pid>/environ` exposes and prevents host secrets from
> leaking to the CLI subprocess.

### Token Isolation (Defense in Depth)

The `COPILOT_SDK_AUTH_TOKEN` environment variable is an irreducible requirement — the SDK
must set it for the CLI subprocess. Since the agent's Bash tool runs commands that inherit
the CLI's env, multiple layers prevent token exfiltration:

1. **Minimal CLI env**: `CopilotClient({ env: minimalEnv })` passes only HOME, PATH,
   NODE_OPTIONS, LANG. The CLI subprocess does NOT inherit `process.env`.
2. **Bash unset prefix**: `onPreToolUse` injects `unset COPILOT_SDK_AUTH_TOKEN ...` before
   every Bash command, stripping the token from subprocess environments.
3. **`/proc/environ` blocking**: `onPreToolUse` denies Bash commands containing
   `/proc/<pid>/environ` and file reads of `/proc/*/environ` paths.
4. **Post-init scrubbing**: After `client.start()`, the agent-runner deletes
   `containerInput.secrets`, and clears `COPILOT_SDK_AUTH_TOKEN`, `GITHUB_TOKEN`,
   `GH_TOKEN` from `process.env`.
5. **No temp file**: Stdin is piped directly to Node via `exec` in the Dockerfile
   entrypoint — secrets are never written to disk.

### Session Persistence

- `configDir` tells the CLI where to store session transcripts (`{configDir}/sessions/{id}.jsonl`)
- `resumeSession(id)` looks up the transcript in the config directory
- Infinite sessions (default enabled) automatically compact when context gets large

### Gotchas

- **Default timeout is 60s**: `sendAndWait()` defaults to 60 seconds. Agent tasks need 600+ seconds.
- **Permissions default to deny**: Without `onPermissionRequest`, all tool calls are denied.
  Use a custom handler returning `{ kind: 'approved' }` for headless operation.
- **Hook errors are swallowed**: If a hook handler throws, the error is logged but not surfaced.
- **Tool handler errors return strings**: If a tool handler throws, the error message is returned to
  the LLM as a tool result (not re-thrown to the caller).
- **`getMessages()` returns `SessionEvent[]`**: Not plain messages. Filter by `event.type === 'user.message'`
  or `'assistant.message'` to get conversation content.
- **MCP servers require `tools` field**: Must specify `tools: ['*']` or a list of tool names.
- **CLI inherits parent env by default**: The CLI process gets all of `process.env` plus SDK-injected vars.
  **Always pass `env: minimalEnv` to CopilotClient** to prevent this. Then use `onPreToolUse` to
  strip `COPILOT_SDK_AUTH_TOKEN` from Bash commands.
- **`/proc/environ` bypasses `unset`**: Even after `unset`, the original env is readable via
  `/proc/<pid>/environ`. Block this path in `onPreToolUse` for both Bash and file read tools.
- **`onPreToolUse` deny format**: Use `{ permissionDecision: 'deny', permissionDecisionReason: '...' }`
  to block tool invocations (not `{ decision: 'deny' }`).

---

## Key Differences from Claude Agent SDK

| Feature | Claude Agent SDK | GitHub Copilot SDK |
|---------|-----------------|-------------------|
| Package | `@anthropic-ai/claude-agent-sdk` | `@github/copilot-sdk` |
| Auth | `ANTHROPIC_API_KEY` | `githubToken` constructor option |
| Tool def | `tool('name', desc, params, handler)` | `defineTool('name', { description, parameters, handler })` |
| Send msg | `query()` async generator | `session.sendAndWait({ prompt }, timeout)` |
| System | `systemPrompt: string` | `systemMessage: { mode: 'append'\|'replace', content }` |
| MCP | Direct config | Requires `tools: ['*']` property |
| Permissions | Hooks | `onPermissionRequest: approveAll` |
| Hooks | `PreToolUse`, `PreCompact` callbacks | `SessionHooks` object with `onPreToolUse`, `onSessionEnd`, etc. |
| Sessions | `resume: sessionId` option | `client.resumeSession(sessionId, config)` |
| Config dir | `~/.claude/` | `configDir` option in SessionConfig |
| Skills | Filesystem copy to `.claude/skills/` | `skillDirectories` in SessionConfig |
| Settings | `settings.json` with env vars | No equivalent — features configured via SessionConfig |

## Rollback

To revert to Claude Agent SDK:
1. `git checkout container/agent-runner/package.json`
2. `git checkout container/Dockerfile`
3. `git checkout container/agent-runner/src/index.ts`
4. `git checkout src/container-runner.ts`
5. `git checkout .claude/skills/x-integration/agent.ts`
6. `./container/build.sh`
