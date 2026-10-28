import { describe, it, expect } from 'vitest'
import { derivedDateRange, normalizeResultsUrl } from './_utils'
import type { StageInput } from './actions'

function raceStage(start: string, end: string | null = null): StageInput {
  return {
    name: 'Race',
    stage_type: 'race',
    race_type: 'distance',
    start_time: start,
    end_time: end,
    venue: '',
    results_url: null,
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
    results_url: null,
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

describe('normalizeResultsUrl', () => {
  it('treats a blank value as "no link" rather than an error', () => {
    expect(normalizeResultsUrl('')).toEqual({ ok: true, value: null })
    expect(normalizeResultsUrl('   ')).toEqual({ ok: true, value: null })
  })

  it('keeps an http(s) URL', () => {
    expect(normalizeResultsUrl('https://results.example.com/viadal')).toEqual({
      ok: true,
      value: 'https://results.example.com/viadal',
    })
    expect(normalizeResultsUrl('http://results.example.com/')).toEqual({
      ok: true,
      value: 'http://results.example.com/',
    })
  })

  it('adds https:// to a bare host, since that is how links get pasted', () => {
    expect(normalizeResultsUrl('results.example.com/viadal')).toEqual({
      ok: true,
      value: 'https://results.example.com/viadal',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeResultsUrl('  https://results.example.com/  ')).toEqual({
      ok: true,
      value: 'https://results.example.com/',
    })
  })

  it('preserves query strings and fragments, which results links rely on', () => {
    expect(normalizeResultsUrl('https://example.com/r?event=12&cat=M40#top')).toEqual({
      ok: true,
      value: 'https://example.com/r?event=12&cat=M40#top',
    })
  })

  // The value becomes an href on a screen officials are told to trust, so a
  // script-bearing scheme must never be storable. new URL() parses these
  // happily — the protocol allowlist is what rejects them.
  it('rejects schemes that would make the INFO-01 link execute script', () => {
    expect(normalizeResultsUrl('javascript:alert(1)').ok).toBe(false)
    expect(normalizeResultsUrl('JavaScript:alert(1)').ok).toBe(false)
    expect(normalizeResultsUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false)
    expect(normalizeResultsUrl('vbscript:msgbox(1)').ok).toBe(false)
  })

  it('rejects other non-web schemes', () => {
    expect(normalizeResultsUrl('ftp://files.example.com').ok).toBe(false)
    expect(normalizeResultsUrl('mailto:someone@example.com').ok).toBe(false)
  })

  it('rejects a URL with no host at all', () => {
    expect(normalizeResultsUrl('https://').ok).toBe(false)
    expect(normalizeResultsUrl('http://').ok).toBe(false)
  })

  // 'http:///results' is NOT hostless to the URL parser — it reads 'results'
  // as a single-label host and yields 'http://results/'. That is accepted on
  // purpose: a single-label host is a legitimate intranet address, and this
  // field has no way to tell one from a typo. The hostname guard exists for
  // the genuinely hostless forms above, not for this.
  it('accepts a single-label host rather than guessing it is a typo', () => {
    expect(normalizeResultsUrl('http:///results')).toEqual({
      ok: true,
      value: 'http://results/',
    })
  })

  // Matches event_stages_results_url_length_check, so an over-long value is a
  // field error rather than a 23514 surfacing from the RPC.
  it('rejects a value longer than the column allows', () => {
    const tooLong = 'https://example.com/' + 'a'.repeat(2048)
    expect(normalizeResultsUrl(tooLong).ok).toBe(false)
  })
})
