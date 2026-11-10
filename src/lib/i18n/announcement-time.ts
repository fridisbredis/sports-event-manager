import { dateLocaleFor, EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'

// Takes the translator rather than reaching for one: this is a module-level
// helper with no hook or request scope of its own, and the two relative-day
// labels are UI strings like any other. They were hardcoded English before, so
// a Swedish official reading an otherwise Swedish page saw "Today · 14:30".
//
// published_at is a real instant (the server's `new Date().toISOString()` at
// publish time), not one of the wall-clock-UTC timestamps the scheduling side
// stores — so it is the one kind of timestamp that must be converted rather
// than rendered as-is. It was formatted with `timeZone: 'UTC'`, which showed a
// 15:46 announcement as "13:46" to every official.
//
// The relative-day comparison has to run in the same zone as the clock beside
// it, or a late-evening announcement reads "Yesterday · 23:30" the moment UTC
// rolls over while Stockholm is still on the same day.
function eventDayKey(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: EVENT_TIME_ZONE,
  })
}

export function formatAnnouncementTime(
  ts: string,
  language: string,
  t: (key: string) => string
): string {
  const date = new Date(ts)
  const locale = dateLocaleFor(language)
  const day = eventDayKey(date, locale)
  const today = eventDayKey(new Date(), locale)
  const yesterday = eventDayKey(new Date(Date.now() - 86_400_000), locale)
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  })
  if (day === today) return `${t('announcements.today')} · ${time}`
  if (day === yesterday) return `${t('announcements.yesterday')} · ${time}`
  const weekday = date.toLocaleDateString(locale, {
    weekday: 'short',
    timeZone: EVENT_TIME_ZONE,
  })
  return `${weekday} · ${time}`
}
