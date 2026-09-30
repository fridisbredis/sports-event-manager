// Color coding for work areas.
//
// Source of truth: the 30 bg/fg pairs below, delivered as the work-area
// palette for the colour picker (WS-02). They replace the earlier eight from
// docs/design_handoff_admin_dashboard/README.md plus 22 generated to extend
// them; that set was paler and three of its pairs fell short of WCAG AA.
//
// The palette is laid out as the picker renders it: three rows of ten, walking
// the hue circle from warm red through green, teal and blue to violet, then
// back around at a lower chroma. Adjacent swatches are therefore deliberately
// similar — position in this array is the picker's reading order, not a
// distinctness ranking.
//
// `name` is what gets persisted in `workstations.color`, never the hex. That
// keeps a future re-tune of a shade a pure code change with no data migration,
// so treat the names as a stable contract: rename one and you orphan the rows
// holding it.
//
// Every pair clears WCAG AA 4.5:1 (the tightest is 4.51:1), which matters
// because the fg is what draws labels inside a filled schedule cell.

export interface WorkAreaColor {
  /** Stable identifier. Persisted in `workstations.color`; never renders. */
  name: string
  /** Pastel background for chips, dots and filled schedule cells. */
  bg: string
  /** Saturated foreground for text and icons drawn on `bg`. */
  fg: string
}

export const WORK_AREA_COLORS: readonly WorkAreaColor[] = [
  // --- row 1: red -> aqua ---
  { name: 'blush', bg: '#F7B8B8', fg: '#654B4B' }, // 4.79:1
  { name: 'peach', bg: '#F7C9A8', fg: '#655245' }, // 4.72:1
  { name: 'sand', bg: '#F6DDA0', fg: '#6C6146' }, // 4.51:1
  { name: 'straw', bg: '#EFE7A8', fg: '#69664A' }, // 4.83:1
  { name: 'chartreuse', bg: '#DCEBA0', fg: '#616746' }, // 4.99:1
  { name: 'leaf', bg: '#C3E6A8', fg: '#56654A' }, // 4.95:1
  { name: 'meadow', bg: '#AEE0B4', fg: '#475C4A' }, // 5.12:1
  { name: 'jade', bg: '#A6E0C4', fg: '#445C50' }, // 5.19:1
  { name: 'seafoam', bg: '#A0DED3', fg: '#425B57' }, // 5.19:1
  { name: 'aqua', bg: '#9DDAE0', fg: '#40595C' }, // 5.16:1
  // --- row 2: blue -> tan ---
  { name: 'sky', bg: '#9CCDE6', fg: '#40545E' }, // 4.88:1
  { name: 'cornflower', bg: '#A3C1EC', fg: '#434F61' }, // 4.72:1
  { name: 'periwinkle', bg: '#B3BDEF', fg: '#494D62' }, // 4.60:1
  { name: 'lavender', bg: '#C4B4EC', fg: '#4A445A' }, // 4.66:1
  { name: 'lilac', bg: '#D3B0E6', fg: '#504357' }, // 4.57:1
  { name: 'orchid', bg: '#E0AEDD', fg: '#554254' }, // 4.60:1
  { name: 'mauve', bg: '#E8AECB', fg: '#5F4753' }, // 4.51:1
  { name: 'rose', bg: '#EDACB8', fg: '#5A4146' }, // 4.79:1
  { name: 'clay', bg: '#E9B3A3', fg: '#604943' }, // 4.51:1
  { name: 'tan', bg: '#E0BE9B', fg: '#5C4E40' }, // 4.60:1
  // --- row 3: ochre -> violet, lower chroma ---
  { name: 'wheat', bg: '#D9C08C', fg: '#594F39' }, // 4.65:1
  { name: 'olive', bg: '#D6CC8C', fg: '#585439' }, // 4.87:1
  { name: 'moss', bg: '#CBD394', fg: '#53573D' }, // 4.87:1
  { name: 'fern', bg: '#BAD79C', fg: '#4C5840' }, // 4.92:1
  { name: 'sage', bg: '#A9D9AE', fg: '#455947' }, // 5.02:1
  { name: 'mint', bg: '#9CD6C0', fg: '#40584F' }, // 5.00:1
  { name: 'teal', bg: '#9BD1D2', fg: '#405656' }, // 4.87:1
  { name: 'slate', bg: '#A0C6E3', fg: '#42515D' }, // 4.77:1
  { name: 'iris', bg: '#B4BEE8', fg: '#4A4E5F' }, // 4.60:1
  { name: 'heather', bg: '#C9B8E3', fg: '#524B5D' }, // 4.56:1
] as const

/** Lookup by persisted name. Returns undefined for a name not in the palette. */
export function workAreaColorByName(name: string | null | undefined): WorkAreaColor | undefined {
  if (!name) return undefined
  return WORK_AREA_COLORS.find((color) => color.name === name)
}

/**
 * FNV-1a over the work area's id.
 *
 * Used for entities that have no stored colour of their own — officials'
 * avatars, and work areas created before `workstations.color` existed. Work
 * areas that DO have a stored colour take it from there; see
 * `workAreaColorMap`, which prefers the stored value and only falls back to
 * this hash.
 *
 * Deriving from the immutable id keeps the assignment arbitrary with respect
 * to anything a user controls while staying a pure function, so it renders the
 * same on server and client.
 */
export function workAreaColor(workAreaId: string): WorkAreaColor {
  return WORK_AREA_COLORS[paletteIndex(workAreaId)]
}

/** The hashed palette slot for an id, before any collision resolution. */
function paletteIndex(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % WORK_AREA_COLORS.length
}

/** An id paired with the colour stored for it, if it has one. */
export interface ColorableId {
  id: string
  color?: string | null
}

/**
 * Colors a whole set of ids at once, resolving collisions within the set.
 *
 * Accepts either bare ids (for entities with no stored colour, such as
 * officials) or `{ id, color }` pairs. A recognised stored colour always wins
 * and is never displaced — the admin picked it deliberately, and the picker
 * already marks the colours another work area on the stage is using. Ids with
 * no stored colour hash as before, then probe forward past anything taken.
 *
 * `workAreaColor` hashes each id independently, so two unstored ids in the same
 * list can land on the same color — with 30 colors, seven work areas have a
 * ~50% chance of at least one such pair (the birthday problem). Seen side by
 * side in one table that reads as a bug, whatever the maths says: Testklubben
 * had Social Media and Ringa both on the same colour, and Depån and "Toalett
 * och dusch" both on another.
 *
 * Two properties this deliberately preserves for the unstored ids:
 *
 * - **Order independence.** Ids are resolved in a canonical (sorted) order,
 *   not in list order, so re-sorting a table by name or capacity does not
 *   repaint it. Callers pass ids in whatever order they render.
 * - **Stability under growth.** Adding a work area only ever recolors ones
 *   that were already sharing a color, because an uncontended id is never
 *   displaced.
 *
 * Beyond 30 ids collisions are unavoidable and the extras wrap around, which
 * is the same cosmetic repeat as before. Returns a Map keyed by id.
 */
export function workAreaColorMap(
  ids: readonly (string | ColorableId)[]
): Map<string, WorkAreaColor> {
  const result = new Map<string, WorkAreaColor>()
  const taken = new Set<number>()

  // Collapse duplicates, keeping any stored colour seen for an id. Callers
  // pass whatever they render, which can repeat an id across rows.
  const stored = new Map<string, string | null | undefined>()
  for (const entry of ids) {
    const id = typeof entry === 'string' ? entry : entry.id
    const color = typeof entry === 'string' ? null : entry.color
    if (color || !stored.has(id)) stored.set(id, color)
  }
  // Sorting decouples the assignment from render order: the same set of ids
  // gets the same colors whichever way the caller happens to have sorted it.
  const unique = [...stored.keys()].sort()

  // Stored colours are claimed first so a hashed id can never take a slot an
  // admin explicitly chose. Two work areas deliberately sharing a stored
  // colour both keep it — the picker marks it, but does not forbid it.
  for (const id of unique) {
    const chosen = workAreaColorByName(stored.get(id))
    if (!chosen) continue
    result.set(id, chosen)
    taken.add(WORK_AREA_COLORS.indexOf(chosen))
  }

  for (const id of unique) {
    if (result.has(id)) continue
    const first = paletteIndex(id)
    let index = first
    // Probe forward for a free slot. Bounded by the palette length, so a set
    // larger than the palette simply reuses colors instead of looping.
    for (let step = 0; step < WORK_AREA_COLORS.length; step++) {
      const candidate = (first + step) % WORK_AREA_COLORS.length
      if (!taken.has(candidate)) {
        index = candidate
        break
      }
    }
    taken.add(index)
    result.set(id, WORK_AREA_COLORS[index])
  }

  return result
}

/**
 * The first palette colour not already in `taken`, for defaulting a new work
 * area's colour.
 *
 * Walks the palette in its delivered order rather than hashing, because this
 * runs in a form where the admin can see the grid: "the first free swatch"
 * matches what they are looking at, whereas a hashed pick would look arbitrary
 * and would need an id that does not exist yet anyway.
 *
 * Falls back to the first colour once all thirty are taken — at that point
 * every choice collides, and the picker marks the clash rather than blocking
 * the save.
 */
export function firstFreeWorkAreaColor(taken: readonly string[]): WorkAreaColor {
  const used = new Set(taken)
  return WORK_AREA_COLORS.find((color) => !used.has(color.name)) ?? WORK_AREA_COLORS[0]
}

/**
 * Pastel version of a foreground color, for decorative dots and bullets.
 * Per the handoff these are never drawn at full saturation.
 */
export function workAreaDotColor(color: WorkAreaColor): string {
  return `color-mix(in srgb, ${color.fg} 65%, white)`
}

/**
 * Soft mix for schedule-grid cell borders — the handoff calls for a calm grid,
 * not an alarm-like one, so borders never use the full-strength hue.
 */
export function workAreaBorderColor(color: WorkAreaColor): string {
  return `color-mix(in srgb, ${color.fg} 35%, white)`
}
