import { dateLocaleFor } from '@/lib/i18n/date-locale'

// An event's date range as one short label — "2–7 Jun 2026", or
// "30 Jun – 5 Jul 2026" across a month. null when either end is unset.
// Dates are calendar days stored without a zone, so they are read as UTC.
export function formatDateRange(start: string | null, end: string | null, language: string) {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  const sDay = s.getUTCDate()
  const eDay = e.getUTCDate()
  const locale = dateLocaleFor(language)
  const sMonth = s.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const eMonth = e.toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
  const year = e.getUTCFullYear()
  if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
  return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
}
