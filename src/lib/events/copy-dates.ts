// N23 / TEN-01: the dates a copied event's stages get, before the admin
// changes any of them. Pure, so the create-event dialog stays a thin layer
// over it.
//
// Stage times are wall-clock UTC (project_timestamp_convention), so the date
// of a stage is simply the UTC date of its start_time. Dates here are plain
// 'YYYY-MM-DD' strings — the RPC moves each stage by whole days and keeps its
// time of day, so a time never needs to cross this boundary.

export interface CopySourceStage {
  id: string
  start_time: string | null
}

// A year on, on the same weekday: a yearly race keeps its weekend.
export const NEXT_EDITION_DAYS = 364

const DAY_MS = 86_400_000

export function stageDate(startTime: string): string {
  return new Date(startTime).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

// The stages that need a date: the ones with a start_time. Undated stages
// are copied undated.
export function datedStages<T extends CopySourceStage>(
  stages: T[]
): (T & { start_time: string })[] {
  return stages.filter((s): s is T & { start_time: string } => s.start_time !== null)
}

// Every dated stage placed at the same distance from `firstDate` as it was
// from the first dated stage last time. With no `firstDate`, the first stage
// moves NEXT_EDITION_DAYS on.
export function placeStages(stages: CopySourceStage[], firstDate?: string): Record<string, string> {
  const dated = datedStages(stages)
  if (dated.length === 0) return {}

  const sourceFirst = dated
    .map((s) => stageDate(s.start_time))
    .reduce((min, d) => (d < min ? d : min))
  const shift = daysBetween(sourceFirst, firstDate ?? addDays(sourceFirst, NEXT_EDITION_DAYS))

  return Object.fromEntries(dated.map((s) => [s.id, addDays(stageDate(s.start_time), shift)]))
}

// The earliest-dated stage: the one whose date moves the others.
export function firstDatedStageId(stages: CopySourceStage[]): string | undefined {
  const dated = datedStages(stages)
  if (dated.length === 0) return undefined
  return dated.reduce((first, s) => (s.start_time < first.start_time ? s : first)).id
}

// The admin changed one stage's date. Changing the first stage moves every
// stage they have not set by hand, keeping last time's spacing; any other
// change touches only that stage.
export function changeStageDate(
  stages: CopySourceStage[],
  dates: Record<string, string>,
  touched: ReadonlySet<string>,
  stageId: string,
  date: string
): Record<string, string> {
  if (stageId !== firstDatedStageId(stages)) return { ...dates, [stageId]: date }

  const placed = placeStages(stages, date)
  return Object.fromEntries(
    Object.keys(placed).map((id) => [id, touched.has(id) ? dates[id] : placed[id]])
  )
}

// The suggested name for the next edition: the last year in the name, plus
// one ("Viadal 6D 2026" -> "Viadal 6D 2027"). No year, no suggestion.
export function nextEditionName(name: string): string {
  const match = /^(.*)\b((?:19|20)\d{2})\b(\D*)$/.exec(name.trim())
  if (!match) return ''
  return `${match[1]}${Number(match[2]) + 1}${match[3]}`
}
