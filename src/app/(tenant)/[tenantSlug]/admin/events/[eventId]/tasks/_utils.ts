import { dateLocaleFor } from '@/lib/i18n/date-locale'

// Task times are wall-clock UTC like every other timestamp in the app: the
// admin types 10:00 and 10:00 is what is stored and shown, whatever the
// browser's time zone. The form holds them as 'YYYY-MM-DDTHH:mm' strings with
// no zone, the same shape the stage editor uses for its CalendarDateTime.

/** 'YYYY-MM-DDTHH:mm' (wall clock) → ISO string for the database. */
export function wallClockToIso(local: string): string {
  return new Date(`${local}:00Z`).toISOString()
}

/** ISO string from the database → 'YYYY-MM-DDTHH:mm' (wall clock). */
export function isoToWallClock(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toISOString().slice(0, 16)
}

function dayLabel(iso: string, language?: string): string {
  return new Date(iso).toLocaleDateString(dateLocaleFor(language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function timeLabel(iso: string, language?: string): string {
  return new Date(iso).toLocaleTimeString(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

/**
 * "tis 1 dec · 10:00", or with a start "tis 1 dec · 08:00–10:00" on one day
 * and "mån 30 nov · 08:00 – tis 1 dec · 10:00" across days.
 */
export function formatTaskWhen(
  task: { starts_at: string | null; deadline: string },
  language?: string
): string {
  const end = `${dayLabel(task.deadline, language)} · ${timeLabel(task.deadline, language)}`
  if (!task.starts_at) return end
  const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10)
  if (utcDay(task.starts_at) === utcDay(task.deadline)) {
    return `${dayLabel(task.starts_at, language)} · ${timeLabel(task.starts_at, language)}–${timeLabel(task.deadline, language)}`
  }
  return `${dayLabel(task.starts_at, language)} · ${timeLabel(task.starts_at, language)} – ${end}`
}

/** Past its deadline and not done. `now` is injectable for tests. */
export function isOverdue(task: { done: boolean; deadline: string }, now = new Date()): boolean {
  return !task.done && new Date(task.deadline).getTime() < now.getTime()
}
