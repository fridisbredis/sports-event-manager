import { dateLocaleFor } from './date-locale'

/**
 * Formatting for a stage's day and hours (INFO-01, EVT-02).
 *
 * Stage timestamps are wall-clock UTC — the convention the scheduling side
 * uses — so every format call here pins `timeZone: 'UTC'`. Reading them back
 * in the viewer's zone would shift an 08:00 briefing for anyone travelling to
 * the event from another country. This is deliberately the opposite rule from
 * EVENT_TIME_ZONE, which is for timestamps that record a real instant.
 *
 * Two input shapes reach these helpers and both must work:
 *   - full ISO timestamps from the database ('2026-08-02T12:00:00+00:00'),
 *     which the event-info RPC returns for a timestamptz column;
 *   - bare `datetime-local` strings from the admin form ('2026-08-02T12:00'),
 *     which carry no zone at all.
 * A bare string is therefore given an explicit 'Z' before parsing, rather
 * than being left to the Date constructor's local-time interpretation.
 */

// 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DDTHH:mm:ss' with no zone suffix.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

function toUtcDate(ts: string): Date {
  return new Date(NAIVE_DATETIME.test(ts) ? ts + 'Z' : ts)
}

/** The calendar day of a timestamp, in UTC — the key for "same day?" tests. */
function utcDay(ts: string): string {
  return toUtcDate(ts).toISOString().slice(0, 10)
}

export function formatStageDate(ts: string, language?: string | null): string {
  // The weekday alone cannot be ordered by eye — two stages weeks apart can
  // both read 'Thu'. Day and month disambiguate them; the year is omitted
  // because it is already shown once in the event's date range.
  return toUtcDate(ts).toLocaleDateString(dateLocaleFor(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function formatStageTime(ts: string, language?: string | null): string {
  return toUtcDate(ts).toLocaleTimeString(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
}

/**
 * The two endpoints of a stage's range, each already carrying whatever date
 * it needs to be unambiguous.
 *
 * Returned as parts rather than one joined string for two reasons. The
 * endpoints must stay unbreakable: a plain string wraps wherever it runs out
 * of room — typically mid-date ('Thu 3 / Sept 10:00'), which reads as a
 * different date. And the date belongs on `to` only when the stage actually
 * crosses midnight; a same-day stage repeating its date on both ends is
 * noise.
 *
 * `to` is null when there is no end_time at all, which is a normal state —
 * EVT-02 lets an admin pin a start without yet knowing when the stage ends.
 */
export function stageTimeRangeParts(
  start: string | null,
  end: string | null,
  language?: string | null
): { from: string; to: string | null } | null {
  if (!start) return null
  const from = `${formatStageDate(start, language)} ${formatStageTime(start, language)}`
  if (!end) return { from, to: null }
  // A multi-day stage is the whole point of this helper: 'Sun, 2 Aug 12:00 –
  // 12:00' reads as a zero-length stage, when the stage in fact runs for six
  // days. The end keeps its own date whenever it falls on another day.
  if (utcDay(start) === utcDay(end)) return { from, to: formatStageTime(end, language) }
  return { from, to: `${formatStageDate(end, language)} ${formatStageTime(end, language)}` }
}
