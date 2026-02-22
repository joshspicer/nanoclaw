# Intent: .claude/skills/x-integration/agent.ts modifications

## What changed
Replaced Claude Agent SDK `tool()` API with Copilot SDK `defineTool()` API for X (Twitter) integration tools.

## Key sections

### Imports
- Changed: `import { defineTool, Tool } from '@github/copilot-sdk'` instead of `import { tool } from '@anthropic-ai/claude-agent-sdk'`
- Zod import unchanged (used for parameter schemas)

### Tool definitions
- Changed: `defineTool('x_post', { description, parameters, handler })` instead of `tool('x_post', description, parameters, handler)`
- All 5 tools (`x_post`, `x_like`, `x_reply`, `x_retweet`, `x_quote`) use the same new signature

### Return values
- Changed: handlers return plain strings instead of `{ content, isError }` objects
- Error returns: `return 'Error: ...'` instead of `return { content: 'Error: ...', isError: true }`
- Success returns: `return result.message` instead of `return { content: result.message }`

## Invariants
- All 5 tool names unchanged (`x_post`, `x_like`, `x_reply`, `x_retweet`, `x_quote`)
- Zod parameter schemas unchanged
- IPC file communication pattern unchanged (writes JSON to `/workspace/ipc/`)
- Tool handler logic unchanged (construct IPC payload, write file, return result)

## Must-keep
- All 5 tool definitions with their exact names
- The Zod schemas for each tool's parameters
- The IPC file write pattern for communicating with the host
- The `Tool[]` export for registration with the session
