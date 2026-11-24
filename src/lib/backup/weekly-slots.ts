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

// N25: which of the last four weeks a restore can actually go back to.
//
// assessSlots answers "is the newest backup recent, and are there holes?".
// Choosing a slot to restore needs the question turned around: for each of
// the four weeks the rotation is supposed to cover, is there a slot holding
// THAT week, and if not, say so. The 2026-11-16 drill found only two of four
// slots and nothing on screen said which weeks were gone.
//
// Weeks are derived from capturedAt, the way the workflow itself derives
// them (`date -u +%V` at run time), not from the isoweek tag alone: a week
// number repeats every year, and a slot that outlived its rotation (a job that
// stopped for a month) would otherwise be mistaken for this year's week.

export interface IsoWeek {
  year: number
  week: number
}

export interface CoveredWeek extends IsoWeek {
  /** The slot holding this week's backup, or null: no backup of this week exists. */
  slot: WeeklySlot | null
}

export interface WeekCoverage {
  /** The four weeks the rotation should cover, newest first. */
  weeks: CoveredWeek[]
  /** Slots holding a week older than those four — restorable, but past the rotation. */
  older: WeeklySlot[]
}

/** ISO-8601 week of a UTC instant — the same number `date -u +%V` gives. */
export function isoWeekOf(date: Date): IsoWeek {
  const day = (date.getUTCDay() + 6) % 7 // Monday = 0
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  // The ISO year is the year of the week's Thursday.
  const thursday = new Date(midnight + (3 - day) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1
  return { year, week }
}

/**
 * How long after Sunday 00:00 UTC that week's run counts as due. The job is
 * scheduled 03:17 but GitHub has started it as late as 11:08; Monday noon
 * leaves room for that without calling a merely late run missing.
 */
const RUN_DUE_AFTER_MS = 1.5 * DAY_MS

export function weekCoverage(slots: WeeklySlot[], now: Date): WeekCoverage {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let dueSunday = today - now.getUTCDay() * DAY_MS
  if (now.getTime() < dueSunday + RUN_DUE_AFTER_MS) dueSunday -= 7 * DAY_MS

  // A manual run (workflow_dispatch) can land a week the schedule has not
  // reached yet; the window then starts from that week instead.
  const newest = Math.max(dueSunday, ...slots.map((s) => s.capturedAt.getTime()))

  const key = (w: IsoWeek) => `${w.year}-${w.week}`
  const byWeek = new Map<string, WeeklySlot>()
  for (const s of slots) {
    const k = key(isoWeekOf(s.capturedAt))
    const held = byWeek.get(k)
    if (!held || s.capturedAt > held.capturedAt) byWeek.set(k, s)
  }

  const weeks: CoveredWeek[] = []
  for (let i = 0; i < 4; i++) {
    const w = isoWeekOf(new Date(newest - i * 7 * DAY_MS))
    weeks.push({ ...w, slot: byWeek.get(key(w)) ?? null })
  }

  const covered = new Set(weeks.map((w) => w.slot).filter((s): s is WeeklySlot => s !== null))
  const older = slots
    .filter((s) => !covered.has(s))
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())

  return { weeks, older }
}
