# Isolated Slack development environment

Use this runbook to provision a disposable Slack environment for Gist development. A human Slack workspace operator performs every Slack-side action. Repository workers must not create apps, request credentials, or paste credentials into Git, logs, chat, tickets, or command history.

## Safety boundary

- Use a dedicated **non-production Slack workspace**. Do not install the development app in the production workspace.
- Use synthetic messages only. Do not copy production messages, files, member lists, or exports into the development workspace.
- Keep the app undistributed and install it in one workspace only.
- Invite the app only to the approved test channel.
- Run at most one development Socket Mode process for this app. Stop the old process before starting another.
- Never commit a token, `.env`, Slack export, database, trace, or message content.
- Treat the bot token and app-level token as secrets. Workspace, app, channel, and user IDs are not authentication secrets, but keep them in the operator inventory rather than hardcoding them.

If a non-production workspace is unavailable, stop. Obtain workspace/security-owner approval for an isolated workspace; do not substitute a production channel.

## Operator inventory

Create one access-controlled secret-manager record named `slack-brain / Gist Dev`. Record:

- operator and backup operator;
- creation date and review/expiry date;
- development workspace name and workspace ID;
- Slack app name and app ID;
- approved test channel name and channel ID;
- denied-control channel name and channel ID;
- test-user display name and user ID;
- bot token and app-level Socket Mode token;
- last rotation date.

Do not copy this inventory into the repository or task log.

## 1. Create the app from a manifest

1. Sign in to <https://api.slack.com/apps> as the development workspace operator.
2. Select **Create New App** → **From a manifest**.
3. Select the dedicated non-production workspace. Recheck the workspace name before continuing.
4. Select YAML and paste the manifest below.
5. Review the requested scopes and events, then create the app.
6. Keep **Manage Distribution** disabled. Do not enable organization-wide deployment.

The manifest contains configuration only—never add tokens, IDs, redirect URLs, or signing secrets to it.

```yaml
display_information:
  name: Gist Dev
  description: Isolated Gist development bot; synthetic data only
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Gist Dev
    always_online: false
oauth_config:
  scopes:
    bot:
      - im:write
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - users:read
      - im:read
      - im:history
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

`token_rotation_enabled` remains false because the initial single-workspace adapter reads static `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` values. Follow the manual rotation procedure below. Do not enable OAuth token rotation until runtime support for refresh tokens exists.

### Why each permission exists

| Permission/event | Required behavior |
|---|---|
| `im:write` | Open or continue a direct-message conversation. |
| `app_mentions:read` | Receive mentions of Gist. |
| `channels:history` | Read messages and thread context in public channels where the app is a member. |
| `channels:read` | Resolve public-channel metadata. It does not grant message history for channels the app has not joined. |
| `chat:write` | Post DM and threaded channel responses as Gist. |
| `users:read` | Resolve sender identity needed by the adapter/access checks. |
| `im:read`, `im:history` | Resolve and read authorized direct-message conversations. |
| `app_mention` | Deliver channel mentions. |
| `message.channels` | Deliver ordinary messages and thread follow-ups from joined public channels. |
| `message.im` | Deliver direct messages. |

Do not add user-token scopes, admin scopes, file scopes, search scopes, incoming webhooks, slash commands, or workspace-wide history access. This baseline intentionally excludes private channels, group DMs, reactions, and interactive components. A later approved requirement must add only its matching scope/event and must be followed by app reinstallation.

## 2. Enable Socket Mode and install the app

The manifest enables Socket Mode and event subscriptions. No public request URL is needed.

1. Open **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**.
2. Name it `gist-dev-socket` and grant only `connections:write`.
3. Generate it and copy it directly into the approved secret-manager record. This is the app-level Socket Mode token.
4. Open **Socket Mode** and confirm **Enable Socket Mode** is on.
5. Open **Event Subscriptions** and confirm the three bot events from the manifest are present. Leave request URL blank.
6. Open **Install App** → **Install to Workspace** and approve installation only in the development workspace.
7. Open **OAuth & Permissions** and copy **Bot User OAuth Token** directly into the secret-manager record.
8. Do not copy the client secret or signing secret; this Socket Mode setup does not use them.

Any bot-scope change requires **Reinstall to Workspace** before the installed bot token receives the new grant. Re-run all isolation and smoke checks after reinstalling.

## 3. Create channels and test user

### Channels

1. In the development workspace, create public channel `gist-dev-test`.
2. Set its topic to `Synthetic Gist development only; no production data`.
3. Create public channel `gist-dev-denied` as a negative-control channel.
4. Confirm neither channel is Slack Connect/shared with another workspace.
5. Add the `Gist Dev` app to `gist-dev-test` only. Do not add it to `gist-dev-denied` or any default/general channel.
6. Open the app profile → **About** → channel membership and confirm only `gist-dev-test` is listed.
7. Record both channel IDs in the operator inventory. In Slack, open channel details and copy the channel ID from **About**, or copy the channel link and take its channel-ID segment.

A public test channel is deliberate: it exercises the required `message.channels` event inside a workspace containing no production data. Do not make the channel private without an approved scope change; private channels require different Slack scopes/events.

### Test user

1. Create or invite one dedicated test account, for example `gist-test-user`.
2. Make it a normal internal member—not an owner, admin, guest, bot, or Slack Connect/external user.
3. Give it a unique password and MFA according to organization policy. Never share the login or reuse an operator account password.
4. Add the test user to `gist-dev-test` and `gist-dev-denied`.
5. Confirm the user can open the `Gist Dev` Messages tab and can post synthetic text in both channels.
6. Record only the user ID in the operator inventory. Do not record message text or credentials in project logs.

Use a separate operator account to configure the app. The test user must not be able to manage the app or reveal its tokens.

## 4. Place credentials

### Local development workstation

Use an approved encrypted workstation. Store credentials outside every Git checkout:

```bash
install -d -m 700 "$HOME/.config/slack-brain"
install -m 600 /dev/null "$HOME/.config/slack-brain/dev.env"
${EDITOR:-vi} "$HOME/.config/slack-brain/dev.env"
```

Enter exactly these two assignments in the editor, replacing the placeholder text there—not on the command line:

```bash
SLACK_BOT_TOKEN='PASTE_BOT_TOKEN_HERE'
SLACK_APP_TOKEN='PASTE_APP_LEVEL_TOKEN_HERE'
```

Then verify permissions without printing contents:

```bash
chmod 600 "$HOME/.config/slack-brain/dev.env"
stat -c '%a %n' "$HOME/.config/slack-brain/dev.env"
```

Expected mode: `600`; parent directory: `700`. Never create a repository `.env`, symlink this file into a checkout, pass a token as a command argument, or paste it into shell history.

Load credentials only into the shell that starts the development process:

```bash
set -a
. "$HOME/.config/slack-brain/dev.env"
set +a
# Run the documented development start command here when the Slack adapter exists.
unset SLACK_BOT_TOKEN SLACK_APP_TOKEN
```

### Hosted development runtime

Store the same two variable names in the organization-approved deployment secret manager. Restrict read/update access to development operators and the development runtime identity. Do not expose them as build arguments, image layers, CI logs, artifacts, or plaintext deployment manifests.

## 5. Verify Slack-side isolation

Perform this before connecting any Gist runtime.

1. Confirm app installation workspace ID equals the development workspace ID in the operator inventory.
2. Confirm the production workspace's **Manage apps** list does not contain this app ID.
3. Confirm `Gist Dev` belongs only to `gist-dev-test`.
4. Post one synthetic message in each test channel. Do not mention the app in `gist-dev-denied`, because Slack may offer to add it.
5. Load the two tokens as shown above. Run the checks below; enter channel IDs only at the prompts.

```bash
read -r -p 'Approved test channel ID: ' APPROVED_CHANNEL_ID
read -r -p 'Denied control channel ID: ' DENIED_CHANNEL_ID
export APPROVED_CHANNEL_ID DENIED_CHANNEL_ID
node --input-type=module <<'NODE'
const token = process.env.SLACK_BOT_TOKEN;
const call = async (channel) => {
  const response = await fetch(
    `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=1`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return response.json();
};

const approved = await call(process.env.APPROVED_CHANNEL_ID);
const denied = await call(process.env.DENIED_CHANNEL_ID);
console.log(`approved history: ${approved.ok ? 'ok' : approved.error}`);
console.log(`denied history: ${denied.ok ? 'UNEXPECTED_ACCESS' : denied.error}`);
if (!approved.ok || denied.ok || denied.error !== 'not_in_channel') process.exitCode = 1;
NODE
unset APPROVED_CHANNEL_ID DENIED_CHANNEL_ID
```

Expected sanitized result:

```text
approved history: ok
denied history: not_in_channel
```

Stop if the denied check reports `UNEXPECTED_ACCESS`: remove the app from that channel, inspect all app memberships, and repeat. Slack's `channels:read` scope can expose basic public-channel metadata; this check proves message history is unavailable. Runtime allowlisting remains a second mandatory boundary when implemented.

## 6. Connectivity and behavior smoke checks

No live smoke check is possible until an operator supplies credentials. When credentials are available, first validate them without printing tokens, IDs, WebSocket URLs, or Slack payloads:

```bash
set -a
. "$HOME/.config/slack-brain/dev.env"
set +a
node --input-type=module <<'NODE'
const checks = [
  ['bot auth', 'https://slack.com/api/auth.test', process.env.SLACK_BOT_TOKEN],
  ['socket URL issuance', 'https://slack.com/api/apps.connections.open', process.env.SLACK_APP_TOKEN],
];
let failed = false;
for (const [name, url, token] of checks) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  const valid = body.ok && (name !== 'socket URL issuance' || Boolean(body.url));
  console.log(`${name}: ${valid ? 'ok' : body.error || 'failed'}`);
  failed ||= !valid;
}
if (failed) process.exitCode = 1;
NODE
unset SLACK_BOT_TOKEN SLACK_APP_TOKEN
```

Expected output contains only:

```text
bot auth: ok
socket URL issuance: ok
```

This validates token/API connectivity but does not maintain a WebSocket. Once T104 provides the adapter and documented start command:

1. Ensure every old development process is stopped.
2. Start exactly one Socket Mode process using the external secret file.
3. As the test user, send a synthetic DM. Expect exactly one response.
4. In `gist-dev-test`, mention `@Gist Dev` in a synthetic root message. Expect exactly one response in that message's thread and none at channel root.
5. Add one synthetic follow-up in that thread. Check the behavior required by the current adapter task.
6. Post a synthetic non-mention message in `gist-dev-denied`. Expect no delivered event, stored record, or reply.
7. Stop and restart the process once. Send one new synthetic mention and confirm exactly one reply.
8. Stop the process after testing.

Record only a sanitized result:

```text
Date/time UTC: <time>
App/workspace: isolated development pair verified
Bot auth: pass|fail
Socket connection: pass|fail
DM final replies: 1 expected / <count> observed
Mention final replies: 1 expected / <count> observed
Reply location: thread|incorrect
Denied-channel deliveries/stores/replies: 0 expected / <counts> observed
Reconnect duplicate replies: 0 expected / <count> observed
Operator: <name>
```

Never record channel/user/workspace IDs, tokens, WebSocket URLs, message text, or raw event payloads in Git or task logs. Any duplicate response is a failed smoke check: stop all runtimes and look for another process or app installation before debugging event handling.

## 7. Rotate credentials

Rotate on the organization's normal schedule and immediately after suspected disclosure, operator departure, unexpected app membership, or secret-store access.

### App-level Socket Mode token

1. Generate a new app-level token under **Basic Information** with only `connections:write`.
2. Replace `SLACK_APP_TOKEN` in the approved secret store without logging its value.
3. Stop the old runtime and start one runtime with the new secret.
4. Run token connectivity and one mention smoke check.
5. Revoke the old app-level token in **Basic Information**.
6. Update the inventory's rotation date.

For suspected disclosure, reverse steps 1 and 5: stop runtimes and revoke the exposed token first; accept downtime while creating the replacement.

### Bot token

A single-workspace bot token is tied to the app installation. Use a clean reinstall rather than attempting to edit it:

1. Stop every runtime using the app.
2. Remove/uninstall `Gist Dev` from the development workspace; this revokes installation tokens and removes channel memberships.
3. Reinstall the same manifest into the development workspace and approve only the documented scopes.
4. Replace `SLACK_BOT_TOKEN` in the approved secret store.
5. Re-add the app only to `gist-dev-test`.
6. Repeat isolation, token connectivity, DM, mention, and reconnect checks.
7. Update the inventory's rotation date.

After any manifest scope change, reinstall first and treat the resulting bot credential as the current value. For suspected bot-token disclosure, uninstall immediately, delete the stored old value, and review workspace app activity before reinstalling.

## 8. Teardown

1. Stop all local, CI, and hosted Socket Mode processes for this app.
2. Revoke every app-level token under **Basic Information**.
3. Uninstall the app from the development workspace to revoke installation tokens and remove memberships.
4. Delete the Slack app configuration if it will not be reused.
5. Remove both token values from local and hosted secret stores, including recoverable secret versions according to secret-manager policy.
6. Delete `$HOME/.config/slack-brain/dev.env`. Plain `rm` is not guaranteed secure erasure on SSDs; credential revocation is the security control.
7. Delete or archive the synthetic channels according to workspace retention policy.
8. Deactivate/remove the dedicated test user if no other test needs it.
9. Remove the operator inventory record after required audit retention.
10. Confirm the production workspace never contained the development app ID.

Before any commit, inspect staged content for Slack-token shapes without printing file contents:

```bash
git diff --cached --check
if git diff --cached -U0 | rg -n '(xox[baprs]-|xapp-)[A-Za-z0-9-]{8,}'; then
  echo 'Possible Slack credential in staged diff; unstage and revoke it.' >&2
  exit 1
fi
```

If a credential ever reaches Git, do not merely delete it in a later commit. Revoke it immediately, notify the security owner, and follow repository history-cleanup policy.

## References

- Slack app manifest reference: <https://docs.slack.dev/reference/app-manifest>
- Slack Socket Mode: <https://docs.slack.dev/apis/events-api/using-socket-mode>
- Slack token guidance: <https://docs.slack.dev/authentication/tokens>
- Mastra Slack channel setup: <https://mastra.ai/integrations/channels/slack>
- Chat SDK Slack adapter: <https://chat-sdk.dev/adapters/official/slack>
