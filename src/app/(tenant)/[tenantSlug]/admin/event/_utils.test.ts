import { describe, it, expect } from 'vitest'
import { derivedDateRange } from './_utils'
import type { StageInput } from './actions'

function raceStage(start: string, end: string | null = null): StageInput {
  return {
    name: 'Race',
    stage_type: 'race',
    race_type: 'distance',
    start_time: start,
    end_time: end,
    venue: '',
    position: 0,
    distances: [],
  }
}

function nonRaceStage(start: string): StageInput {
  return {
    name: 'Briefing',
    stage_type: 'non_race',
    race_type: 'distance',
    start_time: start,
    end_time: null,
    venue: '',
    position: 0,
    distances: [],
  }
}

describe('derivedDateRange', () => {
  it('returns null when there are no race stages', () => {
    expect(derivedDateRange([nonRaceStage('2026-08-10T08:00')])).toBeNull()
  })

  it('formats a single-day race as a same-day range', () => {
    expect(derivedDateRange([raceStage('2026-08-10T08:00')])).toBe('10–10 aug. 2026')
  })

  it('formats a multi-day race within the same month as a day range', () => {
    expect(derivedDateRange([raceStage('2026-08-10T08:00', '2026-08-12T08:00')])).toBe(
      '10–12 aug. 2026'
    )
  })

  it('formats a race spanning two months with both month names', () => {
    expect(derivedDateRange([raceStage('2026-08-30T08:00', '2026-09-02T08:00')])).toBe(
      '30 aug. – 2 sep. 2026'
    )
  })

  it('ignores non-race stages when computing the range', () => {
    const stages = [nonRaceStage('2026-01-01T08:00'), raceStage('2026-08-10T08:00')]
    expect(derivedDateRange(stages)).toBe('10–10 aug. 2026')
  })

  // The month name follows the user's language, not the regional default: an
  // English reader saw '2–8 aug. 2026' because the form dropped the argument.
  it('uses the English month name for an English reader', () => {
    expect(derivedDateRange([raceStage('2026-08-02T08:00', '2026-08-08T08:00')], 'en')).toBe(
      '2–8 Aug 2026'
    )
  })

  it('uses the Swedish month name for a Swedish reader', () => {
    expect(derivedDateRange([raceStage('2026-08-02T08:00', '2026-08-08T08:00')], 'sv')).toBe(
      '2–8 aug. 2026'
    )
  })
})
