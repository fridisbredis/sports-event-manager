import type { Locale } from './config'

// Dates and calendar conventions are regional, not linguistic: the users are
// at a Swedish event and expect Monday-first weeks, YYYY-MM-DD and 24-hour
// clocks whichever language they read the UI in. What IS linguistic is the
// weekday and month names — an English reader got "tors 8 okt." before this,
// which is what Peter reacted to on 2026-10-08.
//
// So the regional half is pinned and only the language half follows i18next:
// 'sv-SE' and 'en-SE' agree on 2026-10-08, 14:30 and Monday-first, and differ
// only in that one renders "tors 8 okt." and the other "Thu, 8 Oct".
//
// Deliberately NOT en-GB or en-US. en-GB would render 08/10/2026 instead of
// the ISO date used everywhere else, and en-US additionally brings 10/8/2026,
// 02:30 PM and Sunday-first weeks — which would silently reshape the
// scheduling grid, whose columns are built off this locale's week.
//
// Every toLocale*String call in the app resolves through here rather than
// passing a literal. Before the constant existed the codebase had 'en-GB' in
// 19 places and 'sv-SE' in two, which is how officials' schedules ended up
// showing "Thu" while the admin scheduling grid showed "torsdag".
const DATE_LOCALES: Record<Locale, string> = {
  sv: 'sv-SE',
  en: 'en-SE',
}

// The regional fallback, for the few call sites that format a date with no
// user language in reach — see dateLocaleFor() below.
export const DEFAULT_DATE_LOCALE = DATE_LOCALES.sv

/**
 * The date-formatting locale for a UI language. Pass the language the current
 * render resolved — `useLanguage()` in a client component, `getUserLanguage()`
 * in a server one. An unrecognised or absent value falls back to the regional
 * default, which keeps the format right even when the language is not known.
 */
export function dateLocaleFor(language?: string | null): string {
  if (!language) return DEFAULT_DATE_LOCALE
  return DATE_LOCALES[language as Locale] ?? DEFAULT_DATE_LOCALE
}
