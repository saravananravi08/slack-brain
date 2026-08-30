# Foundation live Slack smoke checklist

Status: **Pending B-01 — operator Slack bot/app credentials are not available.**

Run only in the isolated development workspace from `docs/runbooks/slack-dev-environment.md`. Record identifiers/counts only; never paste tokens, private message text, DB rows, or traces into Git or task logs.

- [ ] Start Gist with validated operator-supplied environment and confirm Socket Mode connects.
- [ ] DM Gist once; confirm one streamed reply in the DM thread.
- [ ] Mention Gist in the approved test channel; confirm one streamed threaded reply.
- [ ] Reply in that subscribed thread without another mention; confirm one threaded reply.
- [ ] Retry the same synthetic event; confirm no duplicate reply.
- [ ] Send an event in the denied test channel; confirm no reply and no model request.
- [ ] Disconnect/reconnect Socket Mode; confirm routing resumes without state repair.
- [ ] Restart the process; confirm the subscribed thread remains subscribed.
- [ ] Send `SIGTERM`, then `SIGINT` in a separate run; confirm socket closes and storage/traces settle cleanly.
- [ ] Scan sanitized operator logs for token/message leakage and any Claude CLI or Slack Bolt request path.
