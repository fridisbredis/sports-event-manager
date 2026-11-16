// N46: what the weekly prod backup slots look like, and whether that is
// healthy. Pure functions only — no network, no clock — so the same rules can
// drive both the daily freshness alert (check-freshness.ts) and, later, N25's
// slot selection, which needs exactly the same answer to "how old is the
// newest backup, and are weeks missing?".
//
// The slots are written by .github/workflows/weekly-db-backup.yml as
// weekly-slot-{0..3}.tar.gz, one per ISO week mod 4, each carrying metadata
// `isoweek` and `capturedat`. See docs/ops/backup-and-restore.md §4b.

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The job is scheduled for Sunday 03:17 UTC but GitHub starts it hours late
 * (observed 08:31-11:08). The check runs daily at 04:00 UTC. After a missed
 * Sunday the newest slot is about 7.7 days old by Monday's check, so 7.5
 * alerts that Monday. The half day of margin keeps a run that is merely late
 * from alerting: it would have to slip past Monday 04:00 to trip this.
 */
export const STALE_AFTER_DAYS = 7.5

/**
 * Consecutive healthy slots are about 7 days apart, give or take the
 * scheduler's hours of drift. A missed week makes it at least 14. Anything
 * past 10 is a missing week, not drift.
 */
export const GAP_AFTER_DAYS = 10

export interface WeeklySlot {
  name: string
  /** From blob metadata `capturedat`; falls back to Last-Modified. */
  capturedAt: Date
  /** From blob metadata `isoweek`; null on a blob written without it. */
  isoWeek: number | null
}

export interface SlotAssessment {
  /** Newest first. */
  slots: WeeklySlot[]
  newest: WeeklySlot | null
  newestAgeDays: number | null
  /**
   * True when there is no slot at all or the newest is older than
   * STALE_AFTER_DAYS. This is the alert condition.
   */
  stale: boolean
  /**
   * Holes between consecutive slots longer than GAP_AFTER_DAYS: each is
   * at least one Sunday whose backup never landed. Informational — a hole
   * stays visible for up to four weeks after the job recovers, so it is not
   * an alert condition on its own.
   */
  gaps: { after: string; before: string; days: number }[]
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return match ? match[1].trim() : null
}

/**
 * Parses an Azure List Blobs response (`comp=list&include=metadata`). Azure
 * returns a fixed XML shape, and only four leaf values are needed, so this
 * reads them directly rather than pulling in an XML parser or the Azure SDK.
 * Blobs with no usable date are skipped rather than guessed at.
 */
export function parseBlobList(xml: string): WeeklySlot[] {
  const slots: WeeklySlot[] = []
  for (const [, block] of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
    const name = tag(block, 'Name')
    if (!name) continue

    const captured = tag(block, 'capturedat') ?? tag(block, 'Last-Modified')
    const capturedAt = captured ? new Date(captured) : null
    if (!capturedAt || Number.isNaN(capturedAt.getTime())) continue

    const week = tag(block, 'isoweek')
    const isoWeek = week !== null && /^\d+$/.test(week) ? Number(week) : null

    slots.push({ name, capturedAt, isoWeek })
  }
  return slots
}

export function assessSlots(slots: WeeklySlot[], now: Date): SlotAssessment {
  const sorted = [...slots].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
  const newest = sorted[0] ?? null
  const newestAgeDays = newest ? (now.getTime() - newest.capturedAt.getTime()) / DAY_MS : null

  const gaps: SlotAssessment['gaps'] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const days = (sorted[i].capturedAt.getTime() - sorted[i + 1].capturedAt.getTime()) / DAY_MS
    if (days > GAP_AFTER_DAYS) {
      gaps.push({ after: sorted[i + 1].name, before: sorted[i].name, days: round1(days) })
    }
  }

  return {
    slots: sorted,
    newest,
    newestAgeDays: newestAgeDays === null ? null : round1(newestAgeDays),
    stale: newestAgeDays === null || newestAgeDays > STALE_AFTER_DAYS,
    gaps,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
