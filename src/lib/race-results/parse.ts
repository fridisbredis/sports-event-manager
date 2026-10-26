/**
 * Turning a Race Results list response into participant rows.
 *
 * Pure functions, no network — the fetching lives in `client.ts`. Keeping
 * the shape handling here is what makes the awkward parts of this API
 * testable against a committed fixture of a real response
 * (`__fixtures__/list-361004.json`, captured from event 361004 on
 * 2026-10-26).
 *
 * THE RESPONSE IS POSITIONAL, AND THAT IS THE MAIN HAZARD. Rows arrive as
 * arrays of strings, not objects:
 *
 *   ["1", "16", "Höskuldur Kristvinsson", "[img:/graphics/flags/IS.svg]",
 *    "M", "M75", "Náttúruhlaup"]
 *
 * The meaning of each position is given by a separate `DataFields` array:
 *
 *   ["BIB", "ID", "FLNAME", "NATION.FLAG", "KönM/K", "AGEGROUP.NAME", "CLUB"]
 *
 * Field order is NOT guaranteed between lists or between races, so every
 * lookup here goes through DataFields by name. Hard-coding an index would
 * work against Viadal and silently mis-assign columns for the next race —
 * names landing in the club column, say, with nothing to indicate a fault.
 */

/** A participant as Race Results describes it, before it becomes a DB row. */
export interface ParsedParticipant {
  /**
   * Race Results' own row identity (its `ID` field) — the upsert key, and
   * NOT the bib. Verified against event 361004 on 2026-10-26: all 42 rows
   * carry a distinct ID, and the two ranges differ plainly (bib 1..747,
   * ID 2..48). Bib would be the wrong key anyway, since race numbers repeat
   * across stages and the card merges every stage into one list.
   */
  externalId: string
  bib: string | null
  name: string | null
  /** ISO country code such as 'IS', normalised from the flag image path. */
  nation: string | null
  /** 'M' | 'K' as Race Results reports it; stored verbatim. */
  gender: string | null
  /** The card's "class" — Race Results AGEGROUP.NAME. */
  category: string | null
  club: string | null
  /**
   * Every other field in the response, keyed by its Race Results field
   * name. The card's "Remaining Race Results fields stored as 'other' and
   * shown read-only" — a jsonb column precisely because the field set
   * differs between races.
   */
  extra: Record<string, string>
}

/** The subset of a list response this module reads. */
export interface RaceResultsListResponse {
  DataFields?: unknown
  data?: unknown
}

/**
 * The Race Results field names that map onto real columns. Anything else in
 * the response lands in `extra`.
 *
 * `KönM/K` carries a non-ASCII character in the field NAME itself. (The
 * spike wrote it `KonM/K`, without the umlaut; the live response disagrees.
 * Matched exactly here, with the ASCII spelling accepted as a fallback in
 * case it varies by race configuration.)
 */
const GENDER_FIELDS = ['KönM/K', 'KonM/K'] as const

/**
 * Normalise a `NATION.FLAG` value to an ISO country code.
 *
 * The API returns an image reference rather than a code:
 *   '[img:/graphics/flags/IS.svg]' -> 'IS'
 *
 * A value that is already a plain code is passed through, so a race
 * configured to emit one directly still works. Anything unrecognisable
 * returns null rather than storing the raw markup, which would show the
 * admin '[img:/graphics/flags/IS.svg]' in a column headed "Nation".
 */
export function normaliseNation(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (value === '') return null

  const fromImage = value.match(/\/([A-Za-z]{2,3})\.svg/)
  if (fromImage) return fromImage[1].toUpperCase()

  if (/^[A-Za-z]{2,3}$/.test(value)) return value.toUpperCase()

  return null
}

/** Empty strings are how this API spells "no value"; treat them as absent. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Parse a list response into participants.
 *
 * Rows missing an `ID` are skipped rather than imported: without the upsert
 * key a row cannot be matched on re-import, so it would be duplicated on
 * every run. The count of skipped rows is returned so the caller can tell
 * the admin, rather than quietly importing fewer people than the race has
 * (F-REL-10: a silent shortfall renders as a plausible-looking list).
 */
export function parseParticipantList(response: RaceResultsListResponse): {
  participants: ParsedParticipant[]
  skipped: number
} {
  const fields = Array.isArray(response?.DataFields)
    ? (response.DataFields as unknown[]).map((f) => String(f))
    : []

  if (fields.length === 0) return { participants: [], skipped: 0 }

  const indexOf = (name: string): number => fields.indexOf(name)
  const firstIndexOf = (names: readonly string[]): number => {
    for (const name of names) {
      const index = indexOf(name)
      if (index !== -1) return index
    }
    return -1
  }

  const idIndex = indexOf('ID')
  const bibIndex = indexOf('BIB')
  const nameIndex = indexOf('FLNAME')
  const nationIndex = indexOf('NATION.FLAG')
  const genderIndex = firstIndexOf(GENDER_FIELDS)
  const categoryIndex = indexOf('AGEGROUP.NAME')
  const clubIndex = indexOf('CLUB')

  // Every index that maps to a real column, so `extra` can collect the rest.
  const mapped = new Set(
    [idIndex, bibIndex, nameIndex, nationIndex, genderIndex, categoryIndex, clubIndex].filter(
      (index) => index !== -1
    )
  )

  // `data` is an object of group name -> rows. The grouping is a display
  // concern (the list is grouped by contest), so the groups are flattened:
  // which stage a participant belongs to is decided by WHICH stage's link
  // was fetched, not by this grouping.
  const groups =
    response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
      ? Object.values(response.data as Record<string, unknown>)
      : []

  const participants: ParsedParticipant[] = []
  let skipped = 0

  for (const group of groups) {
    if (!Array.isArray(group)) continue

    for (const row of group) {
      if (!Array.isArray(row)) {
        skipped += 1
        continue
      }

      const cell = (index: number): string | null =>
        index === -1 || index >= row.length ? null : blankToNull(String(row[index]))

      const externalId = idIndex === -1 ? null : cell(idIndex)
      if (!externalId) {
        skipped += 1
        continue
      }

      const extra: Record<string, string> = {}
      row.forEach((value, index) => {
        if (mapped.has(index)) return
        const fieldName = fields[index]
        if (!fieldName) return
        const text = blankToNull(String(value))
        if (text !== null) extra[fieldName] = text
      })

      participants.push({
        externalId,
        bib: cell(bibIndex),
        name: cell(nameIndex),
        nation: normaliseNation(cell(nationIndex)),
        gender: cell(genderIndex),
        category: cell(categoryIndex),
        club: cell(clubIndex),
        extra,
      })
    }
  }

  return { participants, skipped }
}
