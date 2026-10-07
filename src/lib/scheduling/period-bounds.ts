// Form input → stored instant pair, for official_unavailability.
//
// Lives here rather than beside the Server Action that uses it because a
// `'use server'` file may export nothing but async functions — Next refuses to
// bundle a synchronous export there, even a pure helper. Keeping it in a plain
// module also lets it be unit-tested directly, which is the point: the
// whole-day arithmetic below is the part most likely to be quietly wrong.

export interface PeriodFormInput {
  /** `YYYY-MM-DD` */
  startDate: string
  /** `YYYY-MM-DD` */
  endDate: string
  /** `HH:MM`, or absent for a whole-day period. */
  startTime?: string
  /** `HH:MM`, or absent for a whole-day period. */
  endTime?: string
}

export interface PeriodBounds {
  /** Inclusive lower bound, ISO. */
  startsAt: string
  /** Exclusive upper bound, ISO. */
  endsAt: string
}

/**
 * Turns the form's dates and optional times into a half-open UTC instant pair.
 *
 * Wall-clock UTC per the project convention: `2026-10-10` + `09:00` is
 * 09:00 UTC, not 09:00 in the viewer's zone. Every schedule surface already
 * renders with `timeZone: 'UTC'`, so a period declared as "09:00" must line up
 * with the slot labelled 09:00 on the grid.
 *
 * With no times, the period runs midnight to midnight and the end date is
 * INCLUSIVE — "Saturday to Sunday" means both days in full, so the exclusive
 * upper bound is the start of Monday.
 */
export function toPeriodBounds(input: PeriodFormInput): PeriodBounds {
  const { startDate, endDate, startTime, endTime } = input

  if (startTime && endTime) {
    return {
      startsAt: new Date(`${startDate}T${startTime}:00.000Z`).toISOString(),
      endsAt: new Date(`${endDate}T${endTime}:00.000Z`).toISOString(),
    }
  }

  const end = new Date(`${endDate}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)

  return {
    startsAt: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
    endsAt: end.toISOString(),
  }
}

/** The shape of an event stage this module needs — a subset of `event_stages`. */
export interface StageDates {
  stage_date: string | null
  start_time: string | null
  end_time: string | null
}

/**
 * The first and last calendar day an event covers, as `YYYY-MM-DD`.
 *
 * Bounds the availability picker so an official cannot declare time off on a
 * date the event does not run — most of the calendar is noise to them, and a
 * period outside the event is silently useless rather than wrong, which is the
 * worse failure: nobody ever sees it and nobody is told why.
 *
 * Derived from the stages rather than from a column on `events`, because that
 * is where the dates actually live. A stage carries either a full
 * start_time/end_time pair or just a bare `stage_date` (the event-info screen
 * makes the same allowance), so both are read here — using only start_time
 * would drop every stage an admin has dated but not yet timed, and silently
 * narrow the range.
 *
 * Returns null when no stage carries a date at all, which the caller must read
 * as "do not constrain the picker": an unbounded picker is a far smaller
 * problem than one that rejects every date.
 */
export function getEventDateRange(stages: StageDates[]): { min: string; max: string } | null {
  const days: string[] = []

  for (const stage of stages) {
    // Each value is already a UTC instant or a bare day, and every schedule
    // surface renders in UTC — so the day is the first ten characters, not a
    // local-time derivation that would shift west of UTC.
    if (stage.start_time) days.push(stage.start_time.slice(0, 10))
    if (stage.end_time) days.push(stage.end_time.slice(0, 10))
    if (stage.stage_date) days.push(stage.stage_date.slice(0, 10))
  }

  if (days.length === 0) return null

  days.sort()
  return { min: days[0], max: days[days.length - 1] }
}
