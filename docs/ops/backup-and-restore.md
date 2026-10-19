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
   4b. The weekly slot backups
5. The pre-migration snapshot path
6. Restoring a single tenant
7. Known gaps

## 1. Status

| Requirement (card N9)               | Today                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup at least once per day        | **Met** — Supabase Pro, daily, automatic                                                                                                                                                                                                                                                         |
| Kept 30 days                        | **Met for the database** — 7 days daily (Supabase) + 4 weekly slots (~28 days). **Not met for Storage files**, which no backup covers at all (§7).                                                                                                                                               |
| System admin can restore one tenant | **Not met** — no UI, no per-tenant restore                                                                                                                                                                                                                                                       |
| Restore has been tested             | **Partly** — snapshot path (Del 5, 2026-09-07) and weekly slot (Del 6, 2026-10-19) both rehearsed against a local stack, the latter finding a bug that made the restore script fail outright. The dashboard restore (§4) has been read through but never run: running it means overwriting prod. |

Two layers, with deliberately different shapes:

**Daily, last 7 days — Supabase Pro.** Run by the platform, not by anything in
this repo. Fine granularity, short reach. This is what recovers an ordinary
"we broke something yesterday".

**Weekly, last ~28 days — `.github/workflows/weekly-db-backup.yml`.** Ours.
Coarse granularity, long reach. This is what recovers a slow corruption nobody
noticed for a fortnight — the case Supabase's week cannot reach.

Point-in-time recovery would cover both with one mechanism, but it is a paid
add-on and is deliberately off (REL-04). The weekly job is the cheaper answer
to the same requirement; if PITR is ever enabled, the weekly job becomes
redundant and should be deleted rather than left running.

## 2. Which recovery path — decide this first

| What happened                                                                                   | Path                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A destructive migration ran against the wrong rows, and you took a snapshot before pushing      | §5 — the pre-migration snapshot. Closest to the damage, smallest loss. |
| Data loss from something other than a migration (bad write, deletion), discovered within 7 days | §4 — Supabase scheduled backup                                         |
| Data loss between 7 and ~28 days old                                                            | §4b — the weekly slot backups                                          |
| Data loss older than ~28 days                                                                   | **Nothing to restore from.** See §7.                                   |
| One tenant's data is wrong, every other tenant is fine                                          | §6 — read it before touching anything                                  |

**The deciding question is when, not what.** Within a week, Supabase's daily
backups give you a choice of days. Beyond that, the weekly slots give you a
choice of weeks — losing up to seven days of writes is the price of reaching
back that far. Beyond ~28 days nothing recovers it, and the sooner that is
known the sooner the conversation turns to what can be reconstructed by other
means.

## 3. Supabase scheduled backups

- **Where:** Supabase Dashboard → prod project (`rauvaxuypujbeintnnoe`) →
  Database → Backups → Scheduled backups.
  Direct link: https://supabase.com/dashboard/project/rauvaxuypujbeintnnoe/database/backups/scheduled
- **Frequency:** daily, automatic, run by the platform, around 03:35 UTC
  (observed 2026-10-19: eight consecutive nights all between 03:34 and 03:40).
  The dashboard says "around midnight of your project's region"; the project is
  in `eu-west-1`, so the times you see are those.
- **Retention:** 7 days (Pro plan) — but **eight** were listed on 2026-10-19
  (12–19 Oct). Treat 7 as the number you may rely on and anything beyond it as
  a bonus that may vanish without notice.
- **Point-in-time recovery:** **off.** Confirmed against the dashboard
  2026-10-19 — the "Point in time" tab exists for every Pro project whether or
  not it is bought, so its presence is not evidence that it is on. It is a paid
  add-on, deliberately not enabled on cost grounds — see REL-04 in
  `docs/quality-requirements.md`. Without it, recovery granularity is one
  backup per day, not one second.
- **Storage objects are NOT included.** The dashboard states this plainly and
  it is easy to miss: a database backup holds only the _metadata_ rows about
  files, never the files themselves. See §4, step 6.

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

6. **Check the Storage buckets separately. The restore did not touch them.**

   A database backup contains the `storage.objects` metadata rows, not the
   files those rows point at. The dashboard says so on the Backups page, and it
   is the easiest thing on that page to skim past.

   What this means after a restore:
   - A file **deleted** since the backup point is gone for good. The restore
     brings back the row describing it, so the app will render a broken image
     rather than no image — a dangling reference, not a clean absence.
   - A file **uploaded** since the backup point still exists in Storage, but
     the row describing it is gone. The file is orphaned: present, paid for,
     unreachable from the app.

   Two public buckets, both small (verified on prod 2026-10-19):

   | Bucket    | Objects | What breaks if a file is missing            |
   | --------- | ------- | ------------------------------------------- |
   | `logos`   | 5       | Event logo on INFO-01 renders broken        |
   | `avatars` | 2       | Official's avatar on HOME-01 renders broken |

   At this size the practical answer is to **download both buckets before
   restoring** and re-upload anything the restore orphaned:

   ```
   supabase storage cp -r ss:///logos ./storage-backup/logos \
     --project-ref rauvaxuypujbeintnnoe --experimental
   supabase storage cp -r ss:///avatars ./storage-backup/avatars \
     --project-ref rauvaxuypujbeintnnoe --experimental
   ```

   **`--project-ref` is not optional here.** The repo's CLI is linked to the
   _dev_ project, so without it these commands quietly read the wrong
   environment's buckets — and during an incident the output would look
   perfectly plausible.

   Neither bucket holds anything irreplaceable — a logo can be re-uploaded by
   the tenant admin, an avatar by the official — so this is a cosmetic
   cleanup, not a data-loss event. It is listed here because discovering it
   mid-incident looks like the restore failed when it did not.

## 4b. The weekly slot backups

`.github/workflows/weekly-db-backup.yml` dumps prod every Sunday at 03:17 UTC
and uploads it to Azure Blob Storage, container `db-snapshots`, as one of four
rotating slots:

```
weekly-slot-0.tar.gz
weekly-slot-1.tar.gz
weekly-slot-2.tar.gz
weekly-slot-3.tar.gz
```

The slot is the ISO week number mod 4, so week 42 writes slot 2, week 43 slot
3, and week 46 overwrites slot 2 again. **Once the job has run four times
there are four, and the oldest is overwritten by the newest** — the retention
policy lives in the names, so nothing has to delete anything.

Before that there are fewer, and that is not a fault: the job first ran in ISO
week 43 (2026-10-19), so the full set exists from week 46. **Seeing one or two
slots does not mean the others were lost.**

**First, the connection string.** Every `az` command in this section needs
`$BLOB_CONN_STR`. It lives in 1Password, in the **Work** account — not
Personal:

```
export BLOB_CONN_STR="$(op read \
  "op://Viadal Event Manager/Azure Blob sportsevtmgrprodsnaps/password" \
  --account extrapreneurab.1password.com)"
```

**Which slot is newest?** Not obvious from the names, by design — they rotate.
Each blob carries metadata with the ISO week and capture timestamp:

```
az storage blob metadata show \
  --connection-string "$BLOB_CONN_STR" \
  --container-name db-snapshots --name weekly-slot-2.tar.gz
```

Or list all four with their upload times:

```
az storage blob list --connection-string "$BLOB_CONN_STR" \
  --container-name db-snapshots --prefix weekly-slot \
  --query "[].{name:name, modified:properties.lastModified}" -o table
```

**Restoring one** is the same procedure as §5 — same three files, same script:

```
scripts/ops/restore-prod-db.sh weekly-slot-2.tar.gz <target-db-url>
```

Remember the granularity: a weekly backup can be up to seven days stale. Check
its capture timestamp against when the damage started before choosing it over
a daily one.

**If the job fails**, the slot it was writing keeps last cycle's contents —
the upload only happens after the dump is verified non-empty, so a failed run
leaves a four-week-old backup in place rather than an empty file. That is the
intended failure mode, but it means a silently failing job degrades coverage
without any slot looking wrong. Check the workflow's run history if the dates
on the slots look stale.

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

- **Coverage ends at ~28 days.** Anything older is unrecoverable.
- **No PITR.** Granularity is one backup per day within the first week, and one
  per week beyond it. A loss at 23:00 costs a full day of writes, not a few
  minutes — and reaching back three weeks costs up to seven days.
- **Nothing alerts on a failed weekly job.** A failing run leaves the previous
  cycle's blob in that slot, so coverage degrades quietly. GitHub emails the
  repo owner on a failed scheduled workflow by default; that is the only
  signal, and it is worth confirming it actually arrives.
- **No per-tenant restore.** §6.
- **Storage files are not in any backup.** Neither Supabase's scheduled
  backups nor the weekly slots contain the contents of the `logos` and
  `avatars` buckets — only the metadata rows describing them (§4, step 6).
  Nothing backs those files up today. Both buckets are small and their
  contents are re-uploadable by the people who own them, which is why this is
  a gap rather than an emergency; it would stop being small if participant
  photos or documents were ever added.
- **One restore path has never been exercised: the Supabase dashboard restore
  (§4)** — and it is the one a normal data loss would actually use. The other
  two have been: the snapshot path (§5) in `rollback-rehearsal.md` Del 5
  (2026-09-07), and a weekly slot (§4b) in Del 6 (2026-10-19), which found and
  fixed a bug that made `restore-prod-db.sh` fail outright. The dashboard
  restore cannot be rehearsed without overwriting prod, so the realistic
  substitute is the read-through done on 2026-10-19: confirm the backup list,
  know which one you would pick, and know what picking it costs.
- **Nothing alerts on a failed backup.** Supabase does not notify on one, and
  the health page cannot see them (§3). A silent run of failures would only be
  discovered when a restore is attempted.
