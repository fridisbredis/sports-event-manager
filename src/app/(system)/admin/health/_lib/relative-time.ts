// "2h ago" / "2 tim sedan" for the health dashboard's run timestamps.
//
// Intl.RelativeTimeFormat rather than a hand-rolled string table: it already
// knows both locales' plural rules and word order, and it is built in, so this
// adds no dependency. `numeric: 'auto'` lets it say "yesterday"/"igår" where
// that reads better than "1 day ago".
//
// Takes `now` as an argument instead of calling Date.now() internally so the
// tests can pin it — the seed and these timestamps are both relative to the
// real clock, and a test that hardcoded a date would start failing the next
// day.
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

export function relativeTime(iso: string, locale: string, now: Date = new Date()): string | null {
  if (!iso) return null
  const then = new Date(iso)
  // An unparseable timestamp must not render "NaN years ago" — the caller
  // falls back to showing just the conclusion without a time.
  if (Number.isNaN(then.getTime())) return null

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  let duration = (then.getTime() - now.getTime()) / 1000

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return null
}
