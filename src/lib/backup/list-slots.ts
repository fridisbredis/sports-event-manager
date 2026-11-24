import { logger } from '@/lib/logger'

import { parseBlobList, type WeeklySlot } from './weekly-slots'

// Lists the weekly prod backup slots through BACKUP_SLOTS_LIST_URL. Shared by
// the daily freshness alert (N46, check-freshness.ts) and the system admin's
// backup page (N25), so there is one place that builds the request and one
// place that keeps the SAS signature out of the logs.
//
// The credential can only list (sp=l): names, dates and metadata, never the
// dump contents. See check-freshness.ts for why, and
// docs/ops/backup-and-restore.md §4c for how the token is made.

export type SlotListing =
  | { status: 'ok'; slots: WeeklySlot[] }
  | { status: 'error' }
  | { status: 'unconfigured' }

export async function listWeeklySlots(op: string): Promise<SlotListing> {
  const base = process.env.BACKUP_SLOTS_LIST_URL
  if (!base) return { status: 'unconfigured' }

  try {
    const url = new URL(base)
    url.searchParams.set('restype', 'container')
    url.searchParams.set('comp', 'list')
    url.searchParams.set('prefix', 'weekly-slot')
    url.searchParams.set('include', 'metadata')

    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      // Never log the URL: it carries the SAS signature.
      logger.error('Listing the backup slots failed', undefined, { op, status: response.status })
      return { status: 'error' }
    }
    return { status: 'ok', slots: parseBlobList(await response.text()) }
  } catch (err) {
    logger.error('Listing the backup slots failed', err, { op })
    return { status: 'error' }
  }
}
