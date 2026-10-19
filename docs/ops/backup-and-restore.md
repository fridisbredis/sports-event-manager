# Backup and restore — N9

This is a runbook, not a design doc. It is written for whoever has just lost
data in production and did not write any of this.

**Read section 2 first.** The fastest recovery path depends entirely on what
went wrong, and picking the wrong one wastes the window in which the other
would still have worked.

**Contents**

1. Status
2. Which recovery path — decide this first
3. Supabase scheduled backups
4. Restoring from a Supabase backup
5. The pre-migration snapshot path
6. Restoring a single tenant
7. Known gaps

## 1. Status

| Requirement (card N9)               | Today                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| Backup at least once per day        | **Met** — Supabase Pro, daily, automatic                         |
| Kept 30 days                        | **Not met** — retention is 7 days                                |
| System admin can restore one tenant | **Not met** — no UI, no per-tenant restore                       |
| Restore has been tested             | **Partly** — rehearsed against a local stack, never against prod |

The daily requirement is met by the platform, not by anything in this repo.
The Supabase organisation (Extrapreneur AB) is on the **Pro** plan, verified
against the Management API on 2026-10-19, which includes daily automated
backups with **seven days** of retention.

Closing the 7 → 30 day gap costs money — either the PITR add-on or running our
own nightly dump pipeline — and is Peter's decision. It is tracked on card N9
and deliberately not decided here.

## 2. Which recovery path — decide this first

| What happened                                                                                   | Path                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A destructive migration ran against the wrong rows, and you took a snapshot before pushing      | §5 — the pre-migration snapshot. Closest to the damage, smallest loss. |
| Data loss from something other than a migration (bad write, deletion), discovered within 7 days | §4 — Supabase scheduled backup                                         |
| Data loss older than 7 days                                                                     | **Nothing to restore from.** See §7.                                   |
| One tenant's data is wrong, every other tenant is fine                                          | §6 — read it before touching anything                                  |

**The deciding question is when, not what.** Supabase's backups go back seven
days and no further. If the loss is older than that, no procedure in this
document recovers it, and the sooner that is known the sooner the conversation
turns to what can be reconstructed by other means.

## 3. Supabase scheduled backups

- **Where:** Supabase Dashboard → prod project (`rauvaxuypujbeintnnoe`) →
  Database → Backups → Scheduled backups.
  Direct link: https://supabase.com/dashboard/project/rauvaxuypujbeintnnoe/database/backups/scheduled
- **Frequency:** daily, automatic, run by the platform.
- **Retention:** 7 days (Pro plan).
- **Point-in-time recovery:** **off.** It is a paid add-on and was deliberately
  not enabled on cost grounds — see REL-04 in `docs/quality-requirements.md`.
  Without it, recovery granularity is one backup per day, not one second.

The system health page (SYS-03) shows these facts and links to the dashboard.
It deliberately reports **no status**: this app holds no credential that could
ask Supabase whether last night's backup actually ran, and a green tick
asserted from a constant would be a claim nobody verified — the worst thing to
put on a page an operator consults during an incident.

**So the dashboard is the source of truth.** If it matters whether a specific
night's backup exists, open the link and look.

## 4. Restoring from a Supabase backup

> **A restore overwrites the entire database.** Every tenant, not just the one
> with the problem. Everything written since the backup point is gone. Read §6
> before restoring when only one tenant is affected.

1. **Stop writes if you can.** A restore while the app is live means anything
   written during it is lost anyway, and users see inconsistent state. For a
   short outage, scale the prod Container App to zero replicas:

   ```
   az containerapp update -n sports-event-manager-prod \
     -g sports-event-manager-prod-rg --min-replicas 0 --max-replicas 0
   ```

   Remember to put it back to `--min-replicas 2 --max-replicas 3` afterwards
   (see `docs/ops/operational-readiness.md` §9 for why those numbers).

2. **Take a snapshot of the current broken state first**, before overwriting
   it:

   ```
   scripts/ops/snapshot-prod-db.sh pre-restore-$(date -u +%Y%m%d)
   ```

   This feels redundant while you are trying to get rid of that exact state. It
   is not: if the restore turns out to be the wrong call, or the backup is
   older than you thought, this is the only way back to where you started.

3. **Restore** from the dashboard (Database → Backups → the chosen backup →
   Restore). Supabase runs it; there is no CLI path for scheduled backups.

4. **Verify before reopening.** At minimum: tenant count, and that the most
   recent event and its assignments look right.

   ```sql
   select count(*) from tenants;
   select max(created_at) from assignments;
   ```

   Expect 3 tenants (verified 2026-10-15), one event each.

5. **Bring the app back up** and confirm login works end to end — the auth
   schema is part of the restore, so sessions issued before it are invalid.

## 5. The pre-migration snapshot path

`scripts/ops/snapshot-prod-db.sh` takes a full roles + schema + data dump to
Azure Blob Storage. It is **not a scheduled backup** and is not part of any
policy — it exists for REL-04: a destructive migration that runs cleanly but
against the wrong rows.

It is run by hand, immediately before `supabase db push`, for any migration
classed `Forward-fix: destructive`. The `deploy-prod.yml` gate refuses to push
such a migration whose `Data:` line names no snapshot blob.

To restore one:

```
scripts/ops/restore-prod-db.sh <blob-name> <target-db-url> [--include-roles]
```

The target is an explicit argument, not a default — there is no form of this
command that picks a database for you.

> **The restore script refuses to target prod.** It guards on the prod project
> ref and hostname, by design — it was written for rehearsals and for
> inspecting a snapshot on a branch or dev. Restoring a snapshot into prod is
> therefore a deliberate manual operation, not a script you run under pressure.
> That is the intended friction. See the script header.

Requires: Docker, 1Password CLI signed in to `extrapreneurab.1password.com`,
and the `Viadal Event Manager` vault. Note the vault moved from the Personal
account — an `op` call against the wrong account fails confusingly.

## 6. Restoring a single tenant

**There is no supported way to do this today**, and the obvious approach is
more dangerous than it looks.

A full restore to fix one tenant discards every other tenant's writes since
the backup point. With three tenants in prod running real events, that is
likely to turn one tenant's problem into three.

Extracting one tenant's rows from a backup and writing them back over live
data is not safe to improvise either: every table is tenant-scoped via
`tenant_id`, but foreign keys cross tables, and a partial restore can leave
dangling references — an assignment pointing at an official the restore
removed. A restore that half-succeeds is worse than the original loss, because
now nothing is trustworthy.

If a single tenant needs recovering before this is built:

1. Restore the backup into a **separate** Supabase project or a local stack,
   not over prod. `scripts/ops/restore-prod-db.sh` is built for exactly this
   and refuses to target prod.
2. Extract that tenant's rows there, in a database nobody is using.
3. Write them back as a reviewed, deliberate migration — with a snapshot taken
   first (§4 step 2).

Building this properly is the open half of card N9.

## 7. Known gaps

- **Retention is 7 days, not 30.** Anything older is unrecoverable. Cost
  decision, on card N9, Peter's call.
- **No PITR.** Granularity is one backup per day. A loss at 23:00 costs a full
  day of writes, not a few minutes.
- **No per-tenant restore.** §6.
- **No restore has ever been performed against prod.** `docs/testing/rollback-rehearsal.md`
  covers a rehearsal against a local stack, which verifies the script, not the
  dashboard path in §4 and not prod's actual data volume. The first real
  restore will be learned during an incident, which is the wrong time.
- **Nothing alerts on a failed backup.** Supabase does not notify on one, and
  the health page cannot see them (§3). A silent run of failures would only be
  discovered when a restore is attempted.
