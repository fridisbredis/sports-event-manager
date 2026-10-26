/**
 * Extracting a Race Results event ID from whatever an admin pasted.
 *
 * The import reads `event_stages.results_url` (migration 20261013093537,
 * card N7) — a field a human fills in by hand in the EVT-02 stage modal.
 * So the input is not a canonical URL: it is whatever was in the clipboard.
 * Observed and expected shapes include
 *
 *   https://my.raceresult.com/361004/participants#0_66036E
 *   my.raceresult.com/361004/
 *   https://my2.raceresult.com/361004/RRPublish/data/list?...
 *
 * all of which name event 361004.
 *
 * This is deliberately its own module with its own tests: it is pure string
 * handling with no network, and it is the one place a bad paste turns into a
 * clear message rather than a confusing HTTP failure later.
 */

/** A Race Results event ID: digits only, as they appear in the URL path. */
export type RaceResultsEventId = string

/**
 * Pull the event ID out of a Race Results URL.
 *
 * Returns `null` rather than throwing for anything unusable — a blank field,
 * a link to some other site, or a raceresult.com URL with no event ID in it.
 * The caller turns that into a translated message naming the stage, which is
 * more useful than an exception: the admin needs to know WHICH stage's link
 * is wrong, and this function does not know the stage.
 */
export function parseRaceResultsEventId(
  input: string | null | undefined
): RaceResultsEventId | null {
  if (!input) return null

  const trimmed = input.trim()
  if (trimmed === '') return null

  // Accept a pasted host without a scheme ("my.raceresult.com/361004").
  // URL cannot parse that, and prefixing https:// is safe here because the
  // host is checked against the allow-list below either way.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  // Only raceresult.com and its subdomains. Without this an admin pasting a
  // link to an entirely different timing provider would get an event ID
  // extracted from it and a confusing 404 from the API, instead of being
  // told the link is not a Race Results link.
  //
  // Matched on the parsed hostname against a suffix (not `includes`), so
  // `raceresult.com.example.net` is rejected rather than accepted.
  const host = url.hostname.toLowerCase()
  if (host !== 'raceresult.com' && !host.endsWith('.raceresult.com')) return null

  // The event ID is the first all-digits path segment. Taking the first
  // rather than any segment matters for the API URLs, where later segments
  // can also be numeric.
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const eventId = segments.find((segment) => /^\d+$/.test(segment))

  return eventId ?? null
}
