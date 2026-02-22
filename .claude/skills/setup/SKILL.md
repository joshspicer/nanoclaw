---
name: setup
description: Run initial NanoClaw setup. Use when user wants to install dependencies, configure Telegram, set up GitHub authentication, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw Setup

Run setup scripts automatically. Only pause when user action is required (pasting a token, configuration choices). Scripts live in `.claude/skills/setup/scripts/` and emit structured status blocks to stdout. Verbose logs go to `logs/setup.log`.

**Principle:** When something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their manual action (e.g. creating a Telegram bot, pasting a secret token). If a dependency is missing, install it. If a service won't start, diagnose and repair. Ask the user for permission when needed, then do the work.

**UX Note:** Use `AskUserQuestion` for all user-facing questions.

## 1. Check Environment

Run `./.claude/skills/setup/scripts/01-check-environment.sh` and parse the status block.

- If HAS_TELEGRAM_BOT_TOKEN=true → note that Telegram bot token exists, offer to skip step 5
- If HAS_GITHUB_TOKEN=true → note that GitHub credentials exist, offer to skip step 4
- If HAS_REGISTERED_GROUPS=true → note existing config, offer to skip or reconfigure
- Record PLATFORM, APPLE_CONTAINER, and DOCKER values for step 3

**If NODE_OK=false:**

Node.js is missing or too old. Ask the user if they'd like you to install it. Offer options based on platform:

- macOS: `brew install node@22` (if brew available) or install nvm then `nvm install 22`
- Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`, or nvm

If brew/nvm aren't installed, install them first (`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` for brew, `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash` for nvm). After installing Node, re-run the environment check to confirm NODE_OK=true.

## 2. Install Dependencies

Run `./.claude/skills/setup/scripts/02-install-deps.sh` and parse the status block.

**If failed:** Read the tail of `logs/setup.log` to diagnose. Common fixes to try automatically:
1. Delete `node_modules` and `package-lock.json`, then re-run the script
2. If permission errors: suggest running with corrected permissions
3. If specific package fails to build (native modules like better-sqlite3): install build tools (`xcode-select --install` on macOS, `build-essential` on Linux), then retry

Only ask the user for help if multiple retries fail with the same error.

## 3. Container Runtime

### 3a. Choose runtime

Check the preflight results for `APPLE_CONTAINER` and `DOCKER`.

**If APPLE_CONTAINER=installed** (macOS only): Ask the user which runtime they'd like to use — Docker (default, cross-platform) or Apple Container (native macOS). If they choose Apple Container, run `/convert-to-apple-container` now before continuing, then skip to 3b.

**If APPLE_CONTAINER=not_found**: Use Docker (the default). Proceed to install/start Docker below.

### 3a-docker. Install Docker

- DOCKER=running → continue to 3b
- DOCKER=installed_not_running → start Docker: `open -a Docker` (macOS) or `sudo systemctl start docker` (Linux). Wait 15s, re-check with `docker info`. If still not running, tell the user Docker is starting up and poll a few more times.
- DOCKER=not_found → **ask the user for confirmation before installing.** Tell them Docker is required for running agents and ask if they'd like you to install it. If confirmed:
  - macOS: install via `brew install --cask docker`, then `open -a Docker` and wait for it to start. If brew not available, direct to Docker Desktop download at https://docker.com/products/docker-desktop
  - Linux: install with `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`. Note: user may need to log out/in for group membership.

### 3b. Apple Container conversion gate (if needed)

**If the chosen runtime is Apple Container**, you MUST check whether the source code has already been converted from Docker to Apple Container. Do NOT skip this step. Run:

```bash
grep -q "CONTAINER_RUNTIME_BIN = 'container'" src/container-runtime.ts && echo "ALREADY_CONVERTED" || echo "NEEDS_CONVERSION"
```

**If NEEDS_CONVERSION**, the source code still uses Docker as the runtime. You MUST run the `/convert-to-apple-container` skill NOW, before proceeding to the build step.

**If ALREADY_CONVERTED**, the code already uses Apple Container. Continue to 3c.

**If the chosen runtime is Docker**, no conversion is needed — Docker is the default. Continue to 3c.

### 3c. Build and test

Run `./.claude/skills/setup/scripts/03-setup-container.sh --runtime <chosen>` and parse the status block.

**If BUILD_OK=false:** Read `logs/setup.log` tail for the build error.
- If it's a cache issue (stale layers): run `docker builder prune -f`, then retry.
- If Dockerfile syntax or missing files: diagnose from the log and fix.
- Retry the build script after fixing.

**If TEST_OK=false but BUILD_OK=true:** The image built but won't run. Check logs — common cause is runtime not fully started. Wait a moment and retry the test.

## 4. GitHub Authentication (No Script)

If HAS_ENV=true from step 1, read `.env` and check if it already has `GITHUB_TOKEN` or `GH_TOKEN`. If so, confirm with user: "You already have GitHub credentials configured. Want to keep them or reconfigure?" If keeping, skip to step 5.

The agent container needs a GitHub token for the Copilot SDK. Tell the user:

1. Go to https://github.com/settings/tokens and create a Personal Access Token (classic or fine-grained)
2. Required scopes: `copilot` (for Copilot SDK access)
3. Add it to the `.env` file in the project root: `GITHUB_TOKEN=<token>`
4. Let me know when done

Do NOT ask the user to paste the token into the chat. Do NOT use AskUserQuestion to collect the token. Just tell them what to do, then wait for confirmation that they've added it to `.env`. Once confirmed, verify the `.env` file has the key.

## 5. Telegram Bot Setup (No Script)

If HAS_TELEGRAM_BOT_TOKEN=true from step 1, confirm with user: "Telegram bot token already exists. Want to keep it or reconfigure?" If keeping, skip to step 6.

Tell the user:

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create a bot (choose a name and username)
3. BotFather will give you a token like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`
4. Add it to the `.env` file in the project root: `TELEGRAM_BOT_TOKEN=<token>`
5. **Important:** Also send `/setprivacy` to BotFather, select your bot, and choose **Disable** — this allows the bot to see all messages in groups, not just commands

Wait for confirmation, then verify the `.env` file has `TELEGRAM_BOT_TOKEN`.

## 6. Configure Trigger

AskUserQuestion: What trigger word? (default: Andy). In group chats, messages starting with @TriggerWord go to the agent. In DMs with the bot, no prefix needed.

AskUserQuestion: Main channel type?

1. **DM with the bot** (Recommended) — You message the bot directly in a private chat.
2. **Group chat** — Add the bot to a Telegram group. Good for shared access or keeping conversations organized.

## 7. Discover and Register Channel

### For DM with the bot:

The chat ID is discovered when you first message the bot. Steps:

1. Start the service temporarily: `npm run dev` (we'll set up the proper service in step 10)
2. Open Telegram and send `/chatid` to your bot
3. The bot will reply with the chat ID (format: `tg:<number>`)
4. Use that as the JID for registration

### For group chat:

1. Add the bot to your desired Telegram group (as a member)
2. Start the service temporarily: `npm run dev`
3. Send `/chatid` in the group
4. The bot will reply with the group chat ID (format: `tg:-<number>`)
5. Use that as the JID for registration

Once you have the JID, stop `npm run dev` (Ctrl+C) and register:

Run `./.claude/skills/setup/scripts/06-register-channel.sh` with args:
- `--jid "JID"` — from above (`tg:<chat_id>`)
- `--name "main"` — always "main" for the first channel
- `--trigger "@TriggerWord"` — from step 6
- `--folder "main"` — always "main" for the first channel
- `--no-trigger-required` — if DM channel
- `--assistant-name "Name"` — if trigger word differs from "Andy"

## 8. Mount Allowlist

AskUserQuestion: Want the agent to access directories outside the NanoClaw project? (Git repos, project folders, documents, etc.)

**If no:** Run `./.claude/skills/setup/scripts/07-configure-mounts.sh --empty`

**If yes:** Collect directory paths and permissions (read-write vs read-only). Ask about non-main group read-only restriction (recommended: yes). Build the JSON and pipe it to the script:

`echo '{"allowedRoots":[...],"blockedPatterns":[],"nonMainReadOnly":true}' | ./.claude/skills/setup/scripts/07-configure-mounts.sh`

Tell user how to grant a group access: add `containerConfig.additionalMounts` to their entry in `data/registered_groups.json`.

## 9. Start Service

If the service is already running (check `launchctl list | grep nanoclaw` on macOS), unload it first: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` — then proceed with a clean install.

Run `./.claude/skills/setup/scripts/08-setup-service.sh` and parse the status block.

**If SERVICE_LOADED=false:**
- Read `logs/setup.log` for the error.
- Common fix: plist already loaded with different path. Unload the old one first, then re-run.
- On macOS: check `launchctl list | grep nanoclaw` to see if it's loaded with an error status. If the PID column is `-` and the status column is non-zero, the service is crashing. Read `logs/nanoclaw.error.log` for the crash reason and fix it (common: wrong Node path, missing .env, missing bot token).
- On Linux: check `systemctl --user status nanoclaw` for the error and fix accordingly.
- Re-run the setup-service script after fixing.

## 10. Verify

Run `./.claude/skills/setup/scripts/09-verify.sh` and parse the status block.

**If STATUS=failed, fix each failing component:**
- SERVICE=stopped → run `npm run build` first, then restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `systemctl --user restart nanoclaw` (Linux). Re-check.
- SERVICE=not_found → re-run step 9.
- GITHUB_TOKEN=missing → re-run step 4.
- TELEGRAM_BOT_TOKEN=missing → re-run step 5.
- REGISTERED_GROUPS=0 → re-run step 7.
- MOUNT_ALLOWLIST=missing → run `./.claude/skills/setup/scripts/07-configure-mounts.sh --empty` to create a default.

After fixing, re-run `09-verify.sh` to confirm everything passes.

Tell user to test: send a message to their bot (with or without trigger depending on channel type).

Show the log tail command: `tail -f logs/nanoclaw.log`

## Troubleshooting

**Service not starting:** Check `logs/nanoclaw.error.log`. Common causes: wrong Node path in plist (re-run step 9), missing `.env` (re-run steps 4-5), missing bot token.

**Container agent fails:** Ensure the container runtime is running — start it with the appropriate command for your runtime. Check container logs in `groups/main/logs/container-*.log`.

**No response to messages:** Verify the trigger pattern matches. DM chats don't need a prefix. Check the registered JID in the database: `sqlite3 store/messages.db "SELECT * FROM registered_groups"`. Check `logs/nanoclaw.log`.

**Bot not seeing group messages:** Make sure privacy mode is disabled for the bot. Message @BotFather, send `/setprivacy`, select your bot, choose **Disable**.

**Unload service:** `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
