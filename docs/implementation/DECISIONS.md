# Implementation Decision Register

Product decisions originate in PRD Section 15. Coordinator owns this file. Do not resolve assumptions silently in task branches.

| ID | Decision | Status | Owner | Required before | Outcome |
|---|---|---|---|---|---|
| D001 | Approved Slack channel IDs | Open | Product owner | T004, T203, T401 | — |
| D002 | DM access to shared channel knowledge | Open | Product owner/security | T004, T202, T203 | — |
| D003 | Historical archive date range and completeness | Open | Product owner | T301 | — |
| D004 | Message/embedding/trace retention | Open | Product owner/security | T004, T103, T504 | — |
| D005 | Edit/delete propagation policy | Open | Product owner | T004, T404 | — |
| D006 | Workspace membership vs user allowlist | Open | Product owner/security | T203 | — |
| D007 | Generation model/provider | Open | Technical owner | T101, T105 | — |
| D008 | Embedding model/provider | Open | Technical owner | T201 | — |
| D009 | Citation requirement | Open | Product owner | T004, T205 | — |
| D010 | Data residency/provider restrictions | Open | Security owner | T101, T103, T201 | — |

## Decision entry template

```text
## Dxxx — Title
- Status: Accepted | Rejected | Superseded
- Date:
- Owner:
- Context:
- Options considered:
- Decision:
- Consequences:
- Affected tasks/files:
```
