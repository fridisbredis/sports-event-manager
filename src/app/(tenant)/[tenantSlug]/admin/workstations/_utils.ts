export interface Stage {
  id: string
  name: string
  stage_type: string
  start_time: string | null
  end_time: string | null
}

export interface TimeWindow {
  start: string
  end: string
  limitToDay: string | null
}

export function getStageDays(stage: Stage | null): string[] {
  if (!stage?.start_time || !stage?.end_time) return []
  const daySet = new Set<string>()
  const cur = new Date(stage.start_time)
  cur.setUTCHours(0, 0, 0, 0)
  const last = new Date(stage.end_time)
  last.setUTCHours(0, 0, 0, 0)
  while (cur <= last) {
    daySet.add(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return [...daySet].sort()
}

export function expandWindows(
  windows: TimeWindow[],
  stageDays: string[],
  stageStart: string | null
): { window_start: string; window_end: string }[] {
  return windows
    .filter((w) => w.start && w.end)
    .flatMap((w) => {
      let days: string[]
      if (w.limitToDay) {
        days = [w.limitToDay]
      } else {
        days = stageDays
        if (stageDays.length > 0 && stageStart) {
          const stageStartHHMM = stageStart.slice(11, 16)
          if (w.start < stageStartHHMM) {
            days = stageDays.slice(1)
          }
        }
      }
      return days.map((day) => {
        const overnight = w.end <= w.start
        let endDay = day
        if (overnight) {
          const d = new Date(day + 'T12:00:00Z')
          d.setUTCDate(d.getUTCDate() + 1)
          endDay = d.toISOString().slice(0, 10)
        }
        return { window_start: `${day}T${w.start}`, window_end: `${endDay}T${w.end}` }
      })
    })
}
