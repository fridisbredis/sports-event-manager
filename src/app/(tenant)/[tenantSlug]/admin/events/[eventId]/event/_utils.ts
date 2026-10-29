import type { StageInput } from './actions'
import { dateLocaleFor } from '@/lib/i18n/date-locale'

// Slice the date portion directly from the datetime-local string ('YYYY-MM-DDTHH:mm')
// to avoid Date constructor interpreting it as local time and shifting the date.
export function derivedDateRange(stageList: StageInput[], language?: string): string | null {
  const raceDates = stageList
    .filter((s) => s.stage_type === 'race' && s.start_time)
    .flatMap((s) => [s.start_time!.slice(0, 10), (s.end_time ?? s.start_time!).slice(0, 10)])
    .sort()
  if (!raceDates.length) return null
  const minDate = new Date(raceDates[0] + 'T00:00Z')
  const maxDate = new Date(raceDates[raceDates.length - 1] + 'T00:00Z')
  const sDay = minDate.getUTCDate()
  const eDay = maxDate.getUTCDate()
  const locale = dateLocaleFor(language)
  const sMonth = minDate.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const eMonth = maxDate.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const year = maxDate.getUTCFullYear()
  if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
}

// Accepted external results link. Returns the value to store (trimmed, or
// null when blank), or `invalid` for something we refuse to store.
//
// http/https only, and that restriction is the point of this function rather
// than incidental strictness: the value is rendered as an href on INFO-01, so
// a `javascript:` or `data:` URL entered here would become a script-bearing
// link on a page officials are told to trust. new URL() alone does not reject
// those — it parses them happily — so the protocol allowlist is the check
// that matters. A bare host ("results.example.com") is accepted and
// normalised to https://, because that is how admins actually paste links and
// rejecting it reads as the field being broken.
//
// Deliberately not a format/reachability check beyond that: whether the link
// 404s is not something this form can know, and guessing would block valid
// links to systems we have never seen.
export type ResultsUrlCheck = { ok: true; value: string | null } | { ok: false }

export function normalizeResultsUrl(raw: string): ResultsUrlCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: null }
  // Max matches event_stages_results_url_length_check (migration
  // 20261013093537) so an over-long value is a field error here rather than a
  // 23514 the form would have to decode.
  if (trimmed.length > 2048) return { ok: false }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false }
  // A URL with no host ("https:///path", "http://") parses but points nowhere.
  if (!parsed.hostname) return { ok: false }
  if (parsed.href.length > 2048) return { ok: false }

  return { ok: true, value: parsed.href }
}
