# Gist on Mastra — Implementation Control Center

This folder is the canonical execution system for [`GIST_MASTRA_PRD.md`](../../GIST_MASTRA_PRD.md) and [`MASTRA_MIGRATION_PLAN.md`](../../MASTRA_MIGRATION_PLAN.md).

## Canonical files

- [`STATUS.md`](./STATUS.md) — current phase/task state and assignments.
- [`DEPENDENCY_GRAPH.md`](./DEPENDENCY_GRAPH.md) — task dependencies and safe parallel groups.
- [`FILE_OWNERSHIP.md`](./FILE_OWNERSHIP.md) — write scopes and conflict prevention.
- [`EXECUTION_LOG.md`](./EXECUTION_LOG.md) — integrator-maintained merged-task timeline.
- [`DECISIONS.md`](./DECISIONS.md) — unresolved and accepted implementation decisions.
- [`phases/`](./phases/) — phase objectives, gates, and merged progress.
- [`tasks/`](./tasks/) — one executable specification per task.
- [`logs/`](./logs/) — one append-only work log per task.

## Status model

`Planned → Ready → In Progress → Blocked | Ready for Integration → Completed`

- **Planned:** dependency or product decision is unresolved.
- **Ready:** every dependency is merged and marked `Completed`.
- **In Progress:** assigned worker and branch are recorded.
- **Blocked:** work stopped; reason and unblock condition are in task log.
- **Ready for Integration:** implementation and checks are committed on task branch.
- **Completed:** phase integrator merged the branch, updated phase/status/log files, and recorded merge commit.

Only merged dependencies count. Code present on another worker's branch does not satisfy a dependency.

## Roles

### Coordinator

- Resolves ownership before work starts.
- Updates `STATUS.md` assignment fields on the integration branch.
- Prevents two workers from claiming the same task.
- Resolves cross-phase priority and product decisions.

### Task worker

- Works in one branch/worktree per task.
- Edits only paths listed in the task's **Write scope**.
- Maintains the task file and its dedicated `logs/<TASK-ID>.md`.
- Runs required checks and commits implementation.
- Marks task `Ready for Integration`; never marks it `Completed`.
- Does not edit phase files, `STATUS.md`, or `EXECUTION_LOG.md` while parallel work is active.

### Phase integrator

- Owns shared composition files and phase-level documentation.
- Integrates one ready task at a time.
- Runs phase regression checks after merge.
- Marks merged task `Completed`.
- Updates the phase file, `STATUS.md`, and `EXECUTION_LOG.md` in one integration metadata commit.
- Rejects branches that exceed write scope or omit tests/logs.

A person may hold multiple roles, but the rules still apply.

## Branch and worktree convention

```text
integration/mastra-rewrite       # shared integration branch
task/T101-project-scaffold       # one branch per task
../worktrees/T101                # recommended isolated worktree
```

Create a task branch only after the coordinator marks it `In Progress`:

```bash
git worktree add ../worktrees/T101 -b task/T101-project-scaffold integration/mastra-rewrite
```

Never run parallel tasks in the same working directory.

## Mandatory task workflow

### 1. Claim

1. Confirm every dependency is `Completed` in `STATUS.md`.
2. Confirm no active task owns overlapping files in `FILE_OWNERSHIP.md`.
3. Coordinator records owner, branch, and start time.
4. Worker creates task branch/worktree from latest integration branch.
5. Worker updates only its task file to `In Progress` and starts its task log.

### 2. Implement

At all times:

- Stay within PRD and task scope.
- Edit only task write-scope paths.
- Do not modify unrelated formatting or code.
- Rebase/merge from integration only when necessary; log it.
- Record decisions, failed attempts, commands, and blockers in the task log.
- Add or update tests with behavior changes.
- Never commit credentials, Slack data, database files, generated traces, or `.env`.
- Stop and mark `Blocked` when a dependency/API assumption is wrong.

### 3. Verify

1. Run every command listed in the task's verification section.
2. Run `git diff --check`.
3. Inspect `git status --short` and stage explicit paths only.
4. Confirm no prohibited/shared file was changed.
5. Record concise results in the task log.

### 4. Commit and hand off

Implementation commit:

```bash
git add <explicit-task-paths>
git commit -m "feat(T101): scaffold Mastra runtime"
```

Use `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, or `build` as appropriate. Commit subject must contain the task ID.

Then:

1. Record implementation commit hash in task file and task log.
2. Set task status to `Ready for Integration`.
3. Commit only task metadata:

```bash
git commit -am "docs(T101): hand off project scaffold"
```

4. Send branch and commit hashes to phase integrator.

### 5. Integrate and complete

Phase integrator:

1. Verifies dependency and write-scope compliance.
2. Reviews implementation and task log.
3. Merges without squash so task commits remain traceable.
4. Runs task and phase checks on integration branch.
5. Updates task status to `Completed` and records merge commit/date.
6. Updates phase task table and phase exit criteria.
7. Updates `STATUS.md` and appends one event to `EXECUTION_LOG.md`.
8. Commits metadata:

```bash
git commit -m "docs(P01): complete T101"
```

A task is not complete until this integration commit exists.

## Blocking and changes in scope

When blocked:

1. Stop editing.
2. Set task status to `Blocked`.
3. Log exact blocker, evidence, owner, and unblock condition.
4. Notify coordinator.
5. Do not implement speculative workarounds.

Scope changes require an entry in `DECISIONS.md` and coordinator approval. If acceptance criteria change, update the PRD first.

## Shared-file conflict policy

Workers must not edit:

- `docs/implementation/STATUS.md`
- `docs/implementation/EXECUTION_LOG.md`
- Any `docs/implementation/phases/*.md`
- Another task's file or log
- Shared composition files assigned to a later integration task

Exceptions require an explicit ownership transfer recorded in `STATUS.md` before editing.

## Completion definition

A task is `Completed` only when all are true:

- Deliverables implemented.
- Tests/checks pass.
- Security/privacy constraints checked.
- Task log is current.
- Implementation commit exists.
- Branch merged into integration branch.
- Task file, phase file, status dashboard, and global log are updated.
- Integration metadata commit exists.
