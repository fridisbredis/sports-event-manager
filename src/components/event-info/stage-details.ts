import { formatStageDate, stageTimeRangeParts } from '@/lib/i18n/stage-range'

// A stage carries either a full start timestamp or just a date (stage_date,
// set when the admin has pinned the day but not yet the hour). The card
// should show the day in both cases, so fall back rather than leaving the
// row blank.
//
// Formatting itself lives in @/lib/i18n/stage-range, shared with the admin
// stage list (EVT-02): both screens describe the same stage, and when they
// formatted it separately this screen lost the end date and rendered a
// six-day stage as "Sun, 2 Aug · 12:00 – 12:00".
export function stageDetails(
  stage: { start_time: string | null; stage_date: string | null; end_time: string | null },
  language: string
): string[] {
  const range = stageTimeRangeParts(stage.start_time, stage.end_time, language)
  // The start's date is already inside `from`, so the range carries the day
  // itself and no separate date detail is added beside it.
  if (range) return [range.to ? `${range.from} – ${range.to}` : range.from]
  // stage_date is a bare 'YYYY-MM-DD'; append UTC midnight so it is not
  // parsed as local time and pulled back a day west of Greenwich.
  if (stage.stage_date) return [formatStageDate(stage.stage_date + 'T00:00:00Z', language)]
  return []
}
