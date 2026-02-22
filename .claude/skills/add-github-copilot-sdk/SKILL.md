# Add GitHub Copilot SDK

Switch NanoClaw from Claude Agent SDK to GitHub Copilot SDK backend.

> **Technical Preview**: The Copilot SDK (`@github/copilot-sdk`) is in technical preview.
> The API surface may change between releases. **Always refer to the cloned SDK repository
> at `/Users/josh/git/copilot-sdk/` for the authoritative API** — read the actual source
> files in `nodejs/src/` (especially `types.ts`, `client.ts`, `session.ts`, `index.ts`)
# Add GitHub Copilot SDK

Switch NanoClaw from Claude Agent SDK to GitHub Copilot SDK.

> Technical preview: `@github/copilot-sdk` is pre-release. Always cross-check the cloned SDK at `/Users/josh/git/copilot-sdk/nodejs/src/` (especially `types.ts`, `client.ts`, `session.ts`, `index.ts`) before coding.

## Prerequisites

- GitHub Copilot subscription
- `gh` CLI installed and logged in (`gh auth login`)
- SDK repo cloned locally: `git clone git@github.com:github/copilot-sdk.git /Users/josh/git/copilot-sdk`

## Keep Dependency Current

```bash
cd /Users/josh/git/copilot-sdk && git pull && cat nodejs/package.json | grep version
cd /Users/josh/git/nanoclaw/container/agent-runner
# Align package.json with the latest published SDK version, then reinstall
npm install
```

Repo default: `@github/copilot-sdk@^0.1.25` in container/agent-runner/package.json. Bump to the latest published version when updating the SDK.

## What This Changes

- Backend: Claude Agent SDK → GitHub Copilot SDK
- Auth: Anthropic key/OAuth → GitHub token (`GITHUB_TOKEN`/`GH_TOKEN`)
- Container: `claude-code` CLI → `gh` + Copilot CLI
- Tools: `tool()` → `defineTool(name, config)`
- State: `~/.claude/` → `~/.copilot/` via `configDir`
- Skills: filesystem copy → `skillDirectories` in SessionConfig

## Files Modified

| File | Change |
|------|--------|
| container/agent-runner/package.json | Swap Claude SDK for Copilot SDK |
| container/Dockerfile | Install `gh`; rely on Copilot CLI from SDK |
| container/agent-runner/src/index.ts | Agent loop rewritten for `CopilotClient`/`CopilotSession` |
| src/container-runner.ts | Secrets/mounts updated (`.claude` → `.copilot`); skills via bind mount |
| .claude/skills/x-integration/agent.ts | Tools migrated to `defineTool` API |

## After Applying

1. Add `.env` token:
   ```
   GITHUB_TOKEN=ghp_xxxx
   ```
2. (Optional) Set model overrides (IDs come from `listModels()` and container startup logs):
   ```
   MODEL_FAST=claude-haiku-4.5
   MODEL_DEEP_THOUGHT=claude-opus-4.6-1m
   ```
3. Rebuild container: `./container/build.sh`
4. Smoke test locally: `npm run dev`

---

## SDK Quick Reference

### CopilotClient

```typescript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient({
  githubToken: 'ghp_xxx',              // Prefer explicit token in containers
  cwd: '/workspace',
  logLevel: 'info',
  env: {                              // Minimal env to avoid leaking host vars
    HOME: '/home/node',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    LANG: 'C.UTF-8',
  },
});

await client.start();
const session = await client.createSession(config);
// resumeSession, listSessions, deleteSession, stop, dispose also available
```

### SessionConfig essentials

```typescript
const config: SessionConfig = {
  workingDirectory: '/workspace/group',
  configDir: '/home/node/.copilot',
  model: 'claude-opus-4.6',            // Optional per-session override
  systemMessage: { mode: 'append', content: 'Extra instructions' },
  onPermissionRequest: async () => ({ kind: 'approved' }),
  hooks: {
    onPreToolUse: async () => {},
    onPostToolUse: async () => {},
    onSessionEnd: async () => {},
    onSessionStart: async () => {},
    onUserPromptSubmitted: async () => {},
    onErrorOccurred: async () => {},
  },
  mcpServers: {
    myServer: { command: 'node', args: ['server.js'], tools: ['*'] },
  },
  skillDirectories: ['/workspace/skills/agent-browser'],
  tools: [myCustomTool],
  availableTools: ['Bash', 'Read', 'Write'],
  excludedTools: ['WebFetch'],
  customAgents: [{ name: 'researcher', prompt: 'You are a research specialist...', tools: ['WebFetch'] }],
  infiniteSessions: { enabled: true },
};
```

### CopilotSession

```typescript
// Wait for full response (increase timeout for agent tasks)
const event = await session.sendAndWait({ prompt: 'Hello' }, 600_000);
// Fire-and-forget
await session.send({ prompt: 'More context' });
// Events
session.on('assistant.message', (ev) => ev.data.content);
session.on('session.error', (ev) => ev.data.message);
// History
const events = await session.getMessages();      // SessionEvent[]
await session.destroy();
```

### defineTool

```typescript
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

export const myTool = defineTool('tool_name', {
  description: 'What this tool does',
  parameters: z.object({ arg1: z.string(), arg2: z.number().optional() }),
  handler: async ({ arg1, arg2 }) => ({ content: `${arg1}:${arg2 ?? ''}` }),
});
```

### Key session events

`assistant.message`, `assistant.message_delta`, `user.message`, `session.error`, `session.compaction_start`, `session.compaction_complete`, `session.shutdown`, `tool.execution_start`, `tool.execution_complete`, `subagent.started`, `subagent.completed`.

### PreToolUse hardening (example)

```typescript
onPreToolUse: async (input) => {
  const name = input.toolName;

  if (name === 'Bash' || name === 'bash') {
    const args = input.toolArgs as { command?: string };
    if (!args?.command) return;
    if (/\/proc\/[^/]+\/environ/.test(args.command)) {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Reading /proc/*/environ is blocked',
      };
    }
    const unsetPrefix = `unset ${secretEnvVars.join(' ')} 2>/dev/null; `;
    return { modifiedArgs: { ...args, command: unsetPrefix + args.command } };
  }

  if (['Read', 'read', 'ReadFile', 'read_file'].includes(name)) {
    const args = input.toolArgs as { file_path?: string; path?: string };
    const target = args?.file_path || args?.path || '';
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(target)) {
        return {
          permissionDecision: 'deny',
          permissionDecisionReason: `Reading ${target} is blocked to protect secrets`,
        };
      }
    }
  }
}
```

---

## Security and Operational Notes

- Copilot CLI inherits `process.env` by default; always pass `env: minimalEnv` on `CopilotClient`.
- Token isolation layers: minimal env, Bash `unset` prefix, `/proc/*/environ` blocking, post-init env scrub.
- `sendAndWait` defaults to 60s; set 600s+ for agent workflows.
- Permissions default to deny; supply `onPermissionRequest` (or `approveAll`) for headless runs.
- MCP servers must include `tools: ['*']` or explicit tool list.
- `getMessages()` returns `SessionEvent[]`; filter by `event.type` for chat content.

## Model Routing

- Model is chosen per session (`SessionConfig.model`). Switching models mid-run creates a new context.
- Discover models via `client.listModels()`; the container logs available IDs at startup.

## Key Differences from Claude Agent SDK

| Feature | Claude Agent SDK | GitHub Copilot SDK |
|---------|-----------------|-------------------|
| Package | `@anthropic-ai/claude-agent-sdk` | `@github/copilot-sdk` |
| Auth | `ANTHROPIC_API_KEY` | `githubToken` option |
| Tool def | `tool('name', ...)` | `defineTool('name', { ... })` |
| Send msg | `query()` async generator | `session.sendAndWait({ prompt }, timeout)` |
| System | `systemPrompt: string` | `systemMessage: { mode: 'append'\|'replace', content }` |
| MCP | Direct config | Requires `tools: ['*']` |
| Permissions | Hooks | `onPermissionRequest` (e.g., `approveAll`) |
| Hooks | `PreToolUse`, `PreCompact` | `SessionHooks` object |
| Sessions | `resume: sessionId` | `client.resumeSession(sessionId, config)` |
| Config dir | `~/.claude/` | `configDir` in SessionConfig |
| Skills | Copy into `.claude/skills/` | `skillDirectories` in SessionConfig |
| Settings | `settings.json` | SessionConfig fields

## Rollback

1. git checkout container/agent-runner/package.json
2. git checkout container/Dockerfile
3. git checkout container/agent-runner/src/index.ts
4. git checkout src/container-runner.ts
5. git checkout .claude/skills/x-integration/agent.ts
6. ./container/build.sh
);
