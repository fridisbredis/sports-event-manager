/**
 * Fetching a participant list from Race Results.
 *
 * The public page at my.raceresult.com renders nothing in HTML — the data
 * comes from the undocumented "RRPublish" JSON API, which needs no
 * authentication. The call is two steps:
 *
 *   1. GET https://my.raceresult.com/<eventId>/RRPublish/data/config?page=participants
 *      -> a session `key`, the available lists, and the server that owns
 *         the event.
 *   2. GET https://<server>/<eventId>/RRPublish/data/list?key=...&listname=...
 *      -> the participant rows.
 *
 * THREE THINGS THE SPIKE PAID TO LEARN, each of which is a silent failure
 * if ignored:
 *
 *   - the request must go to the server named in the config response.
 *     `my.` answers 301 and the redirect has to be followed. That server
 *     is not stable: the spike recorded my4 on 2026-10-15 and the same
 *     event answered my2 on 2026-10-26, which is exactly why it is read
 *     from the response every time rather than remembered.
 *   - `key` is mandatory; omitting it returns {"error":"no key given"}
 *     with a 200, so it does not look like a failure.
 *   - the list name varies by race. It is read from the config rather than
 *     hard-coded to 'Online|Deltagare', which is Viadal's Swedish list name
 *     and would not exist for a race configured in another language.
 *
 * THE API IS UNDOCUMENTED AND UNCONTRACTED (spike §6). That is why the
 * import is manual, run on the admin's command once the start list is
 * final, and never a live sync. Everything here returns a typed failure
 * rather than throwing, so a bad response becomes a translated message in
 * the import dialog instead of a crashed page (F-REL-10: queries that
 * swallow errors and render empty).
 */

import { parseParticipantList, type ParsedParticipant } from './parse'

/** Where a fetch stopped, so the UI can say something specific. */
export type RaceResultsErrorKind =
  | 'network' // the request never completed
  | 'http' // a non-2xx response
  | 'malformed' // 2xx, but not the shape we expect
  | 'api_error' // a 200 carrying an {"error": ...} payload
  | 'no_list' // the event exposes no participant list

export interface RaceResultsError {
  ok: false
  kind: RaceResultsErrorKind
  /** English, for logs — never rendered to an admin untranslated. */
  message: string
}

export interface RaceResultsSuccess {
  ok: true
  eventName: string | null
  participants: ParsedParticipant[]
  /** Rows dropped for want of a usable ID; surfaced, never silent. */
  skipped: number
}

export type RaceResultsResult = RaceResultsSuccess | RaceResultsError

/** Injected in tests; defaults to the platform fetch. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const CONFIG_HOST = 'https://my.raceresult.com'

/**
 * How long a single request may take. The import is interactive — an admin
 * is watching a dialog — so a hung third-party request has to fail rather
 * than hold the request open until the platform's own timeout.
 */
const REQUEST_TIMEOUT_MS = 15_000

function failure(kind: RaceResultsErrorKind, message: string): RaceResultsError {
  return { ok: false, kind, message }
}

async function getJson(
  url: string,
  fetchImpl: FetchLike
): Promise<{ ok: true; body: unknown } | RaceResultsError> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      // Follow the 301 from `my.` to the owning server.
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    return failure('network', `Request to Race Results failed: ${String(err)}`)
  }

  if (!response.ok) {
    return failure('http', `Race Results returned HTTP ${response.status}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return failure('malformed', 'Race Results returned a response that is not JSON')
  }

  // A 200 can still carry {"error":"no key given"} — the documented shape
  // of a rejected call. Treated as a failure, not as an empty list.
  if (body && typeof body === 'object' && 'error' in body) {
    return failure(
      'api_error',
      `Race Results reported: ${String((body as { error: unknown }).error)}`
    )
  }

  return { ok: true, body }
}

/** The config fields this module reads. */
interface RaceResultsConfig {
  key?: unknown
  server?: unknown
  eventname?: unknown
  lists?: unknown
}

/**
 * Fetch the participant list for one Race Results event.
 *
 * `eventId` comes from `parseRaceResultsEventId` over the stage's
 * `results_url`, so this function never parses a URL itself.
 */
export async function fetchParticipants(
  eventId: string,
  fetchImpl: FetchLike = fetch
): Promise<RaceResultsResult> {
  const configUrl = `${CONFIG_HOST}/${encodeURIComponent(eventId)}/RRPublish/data/config?page=participants`
  const configResult = await getJson(configUrl, fetchImpl)
  if (!configResult.ok) return configResult

  const config = configResult.body as RaceResultsConfig

  const key = typeof config?.key === 'string' ? config.key : null
  if (!key) {
    return failure('malformed', 'Race Results config carried no key')
  }

  // Fall back to the config host when the response names no server: better
  // to try the host we already reached than to fail outright.
  const server =
    typeof config?.server === 'string' && config.server.trim() !== ''
      ? config.server.trim()
      : 'my.raceresult.com'

  // The list name is per-race configuration, not a constant. Prefer a list
  // whose name looks like a participant list, else take the first one —
  // the config was requested with page=participants, so what it offers is
  // what this event calls its start list.
  const lists = Array.isArray(config?.lists) ? (config.lists as Array<{ Name?: unknown }>) : []
  const listNames = lists
    .map((list) => (typeof list?.Name === 'string' ? list.Name : null))
    .filter((name): name is string => name !== null)

  if (listNames.length === 0) {
    return failure('no_list', 'Race Results event exposes no participant list')
  }

  const listName =
    listNames.find((name) => /deltagare|participant|entries|anmäl/i.test(name)) ?? listNames[0]

  const listUrl =
    `https://${server}/${encodeURIComponent(eventId)}/RRPublish/data/list` +
    `?key=${encodeURIComponent(key)}` +
    `&listname=${encodeURIComponent(listName)}` +
    `&contest=0&r=all`

  const listResult = await getJson(listUrl, fetchImpl)
  if (!listResult.ok) return listResult

  const { participants, skipped } = parseParticipantList(
    listResult.body as Parameters<typeof parseParticipantList>[0]
  )

  return {
    ok: true,
    eventName: typeof config?.eventname === 'string' ? config.eventname : null,
    participants,
    skipped,
  }
}
