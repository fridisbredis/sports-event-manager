// Dates and calendar conventions are regional, not linguistic: the users are
// Swedish and expect Monday-first weeks, YYYY-MM-DD, and weekday/month names
// in Swedish ("tor", not "Thu"). Kept separate from the i18next language on
// purpose — see the same reasoning in src/components/providers.tsx, which
// pins React Aria's locale for the pickers.
//
// Every toLocale*String call in the app reads this rather than passing a
// literal. Before it existed the codebase had 'en-GB' in 19 places and
// 'sv-SE' in two, which is how officials' schedules ended up showing "Thu"
// while the admin scheduling grid showed "torsdag".
export const DATE_LOCALE = 'sv-SE'
