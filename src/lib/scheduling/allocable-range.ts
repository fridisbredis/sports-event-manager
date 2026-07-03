interface Stage {
  stage_type: string
  start_time: string | null
  end_time: string | null
}

interface AllocableRange {
  start: string
  end: string
}

const RACE_BUFFER_MS = 60 * 60 * 1000

export function getAllocableRange(stage: Stage): AllocableRange | null {
  if (!stage.start_time || !stage.end_time) return null

  const start = new Date(stage.start_time)
  const end = new Date(stage.end_time)

  if (stage.stage_type === 'race') {
    start.setTime(start.getTime() - RACE_BUFFER_MS)
    end.setTime(end.getTime() + RACE_BUFFER_MS)
  }

  return { start: start.toISOString(), end: end.toISOString() }
}

export function getAllocableDays(stage: Stage): string[] {
  const range = getAllocableRange(stage)
  if (!range) return []

  const days: string[] = []
  const cur = new Date(range.start)
  cur.setUTCHours(0, 0, 0, 0)
  const end = new Date(range.end)

  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  return days
}
