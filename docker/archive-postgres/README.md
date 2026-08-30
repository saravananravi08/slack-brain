# Synthetic legacy archive — Postgres

A local Postgres instance carrying a **synthetic** copy of the legacy Slack
archive schema, so the T302–T305 import path can be exercised without the real
archive (blocker B-03).

Everything in here is invented. No real workspace, channel, user, or message
text appears, and none may be added.

## Running it

```bash
cd docker/archive-postgres
docker compose up -d
docker compose ps          # wait for the healthcheck to report healthy
```

The container initialises from `init/001-synthetic-archive.sql` on first start
only. To re-seed after changing that file, the volume has to go:

```bash
docker compose down -v && docker compose up -d
```

Bound to `127.0.0.1:55432` — loopback only, so it is not reachable from the
network. Stop it with `docker compose down` when you are not importing.

## Connect as the read-only role, not the admin

Two roles exist, and the distinction is the point:

| Role | Use |
|---|---|
| `archive_admin` | Container initialisation only. **Not for the importer.** |
| `archive_reader` | What the importer connects as. `default_transaction_read_only = on`, and granted only `CONNECT`, `USAGE`, and `SELECT` on the two tables |

T302's acceptance rested on the source being **impossible to mutate** — the
SQLite reader opens with `mode=ro`, `immutable=1`, `PRAGMA query_only`, and
extensions disabled, then asserts read-only before returning. `archive_reader`
is the Postgres equivalent. Connecting the importer as `archive_admin` silently
throws that guarantee away, and nothing downstream would notice: an import is
supposed to only ever read, so a write bug would show up as corrupted source
data rather than an error.

## What the schema is

Matches `REQUIRED_COLUMNS` in `src/migration/source/archive-reader.ts` exactly.
If you change a column name here, the reader's `assertSchema` fails closed with
`SOURCE_SCHEMA_INVALID` — which is the intended behaviour, not a bug to work
around.

```
users     id (PK), name, real_name, display_name
messages  ts (PK), channel_id, user_id, user_name, text, thread_ts,
          reply_count, date, is_thread_reply, raw_json
```

### Two caveats a real archive will not share

1. **`messages.ts` is the primary key.** A Slack `ts` is unique per *channel*,
   not globally. The generator avoids collisions by folding the channel index
   into the fractional part, but a real archive dump would need
   `(channel_id, ts)`. Do not carry this PK over to real data.
2. **`source_ref` is not comparable across readers.** The SQLite reader hashes
   `messages:<rowid>`; the Postgres reader hashes `messages:<ts>`, because
   Postgres has no `rowid` and `ctid` is not stable across vacuum. Both are
   stable *within* their own source, which is all `source_ref` is used for
   (reporting and skip attribution). Content identity is `messageKey`, which is
   derived from workspace/channel/ts and is identical either way — so
   idempotency across a re-import still holds. Do not use `source_ref` to
   compare a SQLite import against a Postgres one.

## What the seed contains

72 messages over three channels, nine users, generated rather than listed so the
shape is easy to change:

| | |
|---|---|
| `C0APPROVED1`, `C0APPROVED2` | 24 messages each — the approved channels |
| `C0UNAPPROV9` | 24 messages — **deliberately unapproved**, so the D001 skip path is exercised |
| Threads | one root plus two replies in every group of six |
| Edits | `raw_json.edited.ts` on every eighth message |

### The awkward rows are deliberate

Four rows look like defects and are not. They exist so the mapper's skip
classification is exercised by real data rather than only by unit fixtures.
**Do not "fix" them.**

| Row | Looks like | Exercises |
|---|---|---|
| sequence 12 | empty `text` | `empty_text` skip |
| sequence 18 | authored by `B0SYNTH001`, `raw_json.subtype = bot_message` | `bot_message` skip |
| sequence 20 | "Synthetic member joined the channel.", `subtype = channel_join` | `system_subtype` skip |
| sequence 12 | `subtype = message_deleted` in `raw_json` | deleted-message handling |

A successful sample import should therefore report skips, not zero skips. An
import that stores all 72 rows has a bug.

## Status

Written for B-03 by pi-coder-15; this README added during review. **The setup
has not been started in a container from this repository** — the compose file
and SQL are unverified by execution. First run should confirm the healthcheck
passes and that `archive_reader` can `SELECT` but not `INSERT`.
