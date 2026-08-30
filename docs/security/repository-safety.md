# Repository safety

Use this checklist before every commit and before sharing logs or artifacts.

## Never commit

- `.env` files or credentials. Keep only placeholder values in `.env.example`.
- Slack tokens, signing secrets, app credentials, exports, message content, or user data.
- Runtime databases, Mastra local state, traces, coverage, logs, or generated artifacts.
- Secret-bearing fixtures such as `test_secrets.js`.

Use least-privilege development credentials. Store them in an approved secret manager or an ignored local `.env`; never paste values into issues, chat, logs, screenshots, or command history.

## Pre-commit checklist

1. Stage explicit paths. Do not use `git add -A` for mixed work.
2. Review path names and staged changes:

   ```bash
   git status --short
   git diff --cached --name-only
   git diff --cached --check
   git diff --cached --stat
   ```

3. Check tracked filenames for local configuration, databases, and secret fixtures:

   ```bash
   git ls-files | grep -E '(^|/)(\.env|.*\.(db|sqlite|sqlite3)|test_secrets\.js)$' && exit 1 || true
   ```

4. Scan tracked content while printing filenames only, not matching values:

   ```bash
   git grep -IlE '(xox[baprs]-|gh[pousr]_|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)' -- . \
     ':(exclude)docs/security/repository-safety.md' || true
   ```

   Treat every listed file as sensitive until reviewed locally. Do not paste matching lines into reports.

5. If `gitleaks` is available, run its redacted repository/history scan:

   ```bash
   gitleaks git --redact --no-banner .
   ```

6. Confirm the final scope against the integration branch:

   ```bash
   git diff --name-only integration/mastra-rewrite...HEAD
   ```

## Local data handling

- Use synthetic, non-sensitive test fixtures.
- Keep Slack exports and database snapshots outside the repository and its worktrees.
- Share only aggregate or redacted diagnostics. Do not share message text, DB rows, full traces, or environment dumps.
- Delete local data under the applicable retention policy when work ends.
- Before attaching an artifact, scan it separately and confirm it contains no credentials or Slack content.

## Credential or data incident

1. Stop staging, committing, pushing, and sharing the affected material.
2. Revoke or rotate exposed credentials immediately. Deleting the file is not sufficient.
3. Notify the security owner and coordinator through the approved private channel. Report repository, path, branch, and commit IDs only—never the secret value or private data.
4. If the file is only staged, remove it from the index without opening it:

   ```bash
   git rm --cached --ignore-unmatch -- <path>
   ```

5. If it reached any commit or remote, do not rewrite shared history independently. The coordinator/security owner must choose and communicate the history-removal procedure. Rotation remains mandatory.
6. Rescan the current tree and history with redacted output. Verify affected remotes, forks, caches, CI artifacts, and logs are remediated.
7. Record the incident and preventive action without credential values, Slack content, DB rows, or full traces.
