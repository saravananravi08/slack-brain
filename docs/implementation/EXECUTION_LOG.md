# Global Execution Log

Integrator-maintained, append-only log of assignments, merges, phase gates, rollbacks, and major blockers. Workers write detailed activity only to `logs/<TASK-ID>.md`.

## Entry format

```text
## YYYY-MM-DD HH:MM UTC — <TASK/PHASE ID> — <event>
- Actor: <name>
- Branch: <branch or n/a>
- Commits: <implementation>, <merge>, <metadata>
- Result: <one-line outcome>
- Verification: <commands/checks>
- Follow-up: <next task, blocker, or none>
```

## Events

_No implementation events recorded yet._
