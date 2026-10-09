import { describe, it, expect } from 'vitest'
import { EVENT_TIME_ZONE, dateLocaleFor } from './date-locale'

/**
 * What this guards: formatting a real instant without pinning a zone.
 *
 * Timestamps that record a moment — `published_at` on an announcement — must
 * render as the event's wall clock no matter where the code runs. Left to the
 * runtime default they follow the container's zone, and the Azure image sets
 * no TZ, so prod formatted them as UTC: an announcement published at 15:46
 * Swedish time read "13:46" to every official. Local dev hid it, because the
 * laptop already is in Stockholm.
 *
 * Note this is the opposite rule from the scheduling side, whose timestamps
 * are wall-clock UTC and are correctly rendered with `timeZone: 'UTC'`.
 */

// 15:46 Stockholm on a summer date (CEST, UTC+2) and a winter one (CET, +1),
// so the test covers the offset actually changing rather than one fixed shift.
const SUMMER_INSTANT = '2026-10-09T13:46:00.000Z'
const WINTER_INSTANT = '2026-12-09T14:46:00.000Z'

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(dateLocaleFor('sv'), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
}

describe('EVENT_TIME_ZONE', () => {
  it('renders an instant as the event wall clock, not as UTC', () => {
    expect(formatTime(SUMMER_INSTANT, EVENT_TIME_ZONE)).toBe('15:46')
    expect(formatTime(WINTER_INSTANT, EVENT_TIME_ZONE)).toBe('15:46')
  })

  it('is unaffected by the zone the process happens to run in', () => {
    // The regression itself: on a UTC host the unpinned default drifts two
    // hours, while the pinned zone holds.
    expect(formatTime(SUMMER_INSTANT, 'UTC')).toBe('13:46')
    expect(formatTime(SUMMER_INSTANT, EVENT_TIME_ZONE)).toBe('15:46')
  })

  it('tracks daylight saving rather than a fixed offset', () => {
    // A hardcoded +02:00 would be right in October and an hour out in
    // December; a named zone is what keeps both correct.
    expect(formatTime(WINTER_INSTANT, 'UTC')).toBe('14:46')
    expect(formatTime(WINTER_INSTANT, EVENT_TIME_ZONE)).toBe('15:46')
  })
})
