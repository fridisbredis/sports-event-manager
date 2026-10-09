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
 * Turns the form's dates and optional times into the half-open UTC instant
 * pairs to store — one per period, so the result is always a list.
 *
 * Wall-clock UTC per the project convention: `2026-10-10` + `09:00` is
 * 09:00 UTC, not 09:00 in the viewer's zone. Every schedule surface already
 * renders with `timeZone: 'UTC'`, so a period declared as "09:00" must line up
 * with the slot labelled 09:00 on the grid.
 *
 * Two shapes, because the form's two modes mean genuinely different things:
 *
 * - **Whole day**, no times: ONE period running midnight to midnight, with the
 *   end date INCLUSIVE — "Saturday to Sunday" means both days in full, so the
 *   exclusive upper bound is the start of Monday. A multi-day absence really is
 *   one unbroken stretch, nights included, so it stays one row.
 *
 * - **A time range**, over one or more days: ONE PERIOD PER DAY, each carrying
 *   that same clock range. "10:00–11:00, Mon to Wed" is three one-hour
 *   absences, not a 49-hour one from Monday morning to Wednesday mid-morning.
 *   The latter is what this used to produce, and it quietly made the official
 *   unschedulable through both intervening nights and all of Tuesday — a
 *   conflict warning on a Tuesday afternoon shift they never said no to. The
 *   error leaned toward making people LESS available than they declared, which
 *   is the direction that actually costs the event staff.
 *
 *   A range whose end reads as earlier than its start (22:00–06:00) is left
 *   alone rather than rolled into the next morning: the action rejects it and
 *   the DB CHECK refuses it, and silently reinterpreting it would turn a
 *   typo into a stored overnight absence nobody typed. To be away overnight,
 *   declare the whole day.
 */
export function toPeriodBounds(input: PeriodFormInput): PeriodBounds[] {
  const { startDate, endDate, startTime, endTime } = input

  if (startTime && endTime) {
    const periods: PeriodBounds[] = []
    const last = new Date(`${endDate}T00:00:00.000Z`)

    for (
      const day = new Date(`${startDate}T00:00:00.000Z`);
      day.getTime() <= last.getTime();
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const date = day.toISOString().slice(0, 10)
      periods.push({
        startsAt: new Date(`${date}T${startTime}:00.000Z`).toISOString(),
        endsAt: new Date(`${date}T${endTime}:00.000Z`).toISOString(),
      })
    }

    return periods
  }

  const end = new Date(`${endDate}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + 1)

  return [
    {
      startsAt: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
      endsAt: end.toISOString(),
    },
  ]
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
