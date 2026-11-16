import { logger } from '@/lib/logger'

import { assessSlots, parseBlobList, STALE_AFTER_DAYS } from './weekly-slots'

// N46: alerts when the weekly prod backup has stopped landing.
//
// On 2026-11-08 and 2026-11-15 weekly-db-backup.yml failed and nobody noticed
// for 15 days — GitHub's failure email was the only signal. This runs on the
// app's daily cron tick instead, so it does not depend on GitHub's scheduler
// (which disables scheduled workflows in a public repo after 60 days without
// commits) and it reaches Sentry, which is watched: logger.error reports
// there. Sentry groups the daily repeats into one issue and alerts on first
// occurrence and on regression after it is resolved.
//
// It checks the result, not the job: "is the newest slot recent enough?"
// catches a failed run, a run that never started, and a run that uploaded
// nowhere, all the same way.
//
// CREDENTIAL. BACKUP_SLOTS_LIST_URL is the db-snapshots container URL with a
// SAS token carrying ONLY the `l` (list) permission. List with
// include=metadata returns names, dates and the isoweek/capturedat tags; it
// cannot read blob contents. Those archives are full prod dumps with real
// phone numbers, so the credential must not be able to download them — which
// is why this does not reuse the health-reader service principal: giving it
// Storage Blob Data Reader would grant exactly that. How to create the token:
// docs/ops/backup-and-restore.md §4c.
//
// An expired or revoked token fails the list call, which is reported like a
// stale backup: from the outside both mean "nobody can vouch for the backup".

const OP = 'POST /api/cron/gdpr-warning'

export type BackupFreshness =
  | { status: 'fresh'; newest: string; ageDays: number }
  | { status: 'stale'; newest: string | null; ageDays: number | null }
  | { status: 'error' }
  | { status: 'unconfigured' }

export async function checkBackupFreshness(now: Date = new Date()): Promise<BackupFreshness> {
  const base = process.env.BACKUP_SLOTS_LIST_URL
  if (!base) {
    // Only prod has backups. Unset anywhere else is the expected state; unset
    // in prod would make this whole check silently absent, which is the very
    // failure it exists to catch.
    if (process.env.SENTRY_ENVIRONMENT === 'production') {
      logger.error(
        'Backup freshness check is not configured: BACKUP_SLOTS_LIST_URL is unset',
        undefined,
        {
          op: OP,
        }
      )
    }
    return { status: 'unconfigured' }
  }

  let xml: string
  try {
    const url = new URL(base)
    url.searchParams.set('restype', 'container')
    url.searchParams.set('comp', 'list')
    url.searchParams.set('prefix', 'weekly-slot')
    url.searchParams.set('include', 'metadata')

    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      // Never log the URL: it carries the SAS signature.
      logger.error('Backup freshness check: listing the backup slots failed', undefined, {
        op: OP,
        status: response.status,
      })
      return { status: 'error' }
    }
    xml = await response.text()
  } catch (err) {
    logger.error('Backup freshness check: listing the backup slots failed', err, { op: OP })
    return { status: 'error' }
  }

  const result = assessSlots(parseBlobList(xml), now)
  const context = {
    op: OP,
    newest: result.newest?.name ?? null,
    newestCapturedAt: result.newest?.capturedAt.toISOString() ?? null,
    newestAgeDays: result.newestAgeDays,
    slots: result.slots.length,
    gaps: result.gaps,
  }

  if (result.stale) {
    logger.error(
      `Weekly prod backup is stale: newest slot is older than ${STALE_AFTER_DAYS} days. ` +
        'Check the run history of weekly-db-backup.yml (docs/ops/backup-and-restore.md §4b).',
      undefined,
      context
    )
    return { status: 'stale', newest: context.newest, ageDays: result.newestAgeDays }
  }

  logger.info('Backup freshness check: ok', context)
  return { status: 'fresh', newest: result.newest!.name, ageDays: result.newestAgeDays! }
}
