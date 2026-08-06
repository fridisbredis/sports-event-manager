import type { StageInput } from './actions'

// Slice the date portion directly from the datetime-local string ('YYYY-MM-DDTHH:mm')
// to avoid Date constructor interpreting it as local time and shifting the date.
export function derivedDateRange(stageList: StageInput[]): string | null {
  const raceDates = stageList
    .filter((s) => s.stage_type === 'race' && s.start_time)
    .flatMap((s) => [s.start_time!.slice(0, 10), (s.end_time ?? s.start_time!).slice(0, 10)])
    .sort()
  if (!raceDates.length) return null
  const minDate = new Date(raceDates[0] + 'T00:00Z')
  const maxDate = new Date(raceDates[raceDates.length - 1] + 'T00:00Z')
  const sDay = minDate.getUTCDate()
  const eDay = maxDate.getUTCDate()
  const sMonth = minDate.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const eMonth = maxDate.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const year = maxDate.getUTCFullYear()
  if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
}
