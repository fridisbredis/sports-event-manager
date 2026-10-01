import type { InitOptions } from 'i18next'

export const defaultNS = 'common'
export const locales = ['en', 'sv'] as const

export type Locale = (typeof locales)[number]
// English both ways, per Peter's decision of 2026-10-01: it is what a user who
// has never chosen a language sees, and it is what fills in for a key missing
// from the language they did choose. Users pick their own language with the
// switcher in each layout, stored per user in user_preferences (migration
// 20261001102501) — so this is the starting point, not what most people end up
// reading.
//
// Note this is only the fallback for a *signed-out or undecided* user. Server
// components resolve the real language with getUserLanguage() in
// ./user-language.ts; passing defaultLocale directly is what the app did before
// the preference existed, and is now wrong anywhere a user could be signed in.
export const defaultLocale = 'en'

// Still a separate constant from defaultLocale even though both are 'en'. They
// answer different questions — "what does an undecided user see" versus "what
// fills in for a missing key" — and a future third locale, or a decision to
// default somewhere by region, would move one without the other.
export const fallbackLocale = 'en'

export const i18nConfig: InitOptions = {
  ns: [defaultNS, 'auth', 'admin', 'official'],
  defaultNS,
  lng: defaultLocale,
  fallbackLng: fallbackLocale,
  fallbackNS: defaultNS,
  interpolation: {
    escapeValue: false, // React escapes by default
  },
  backend: {
    loadPath: `/locales/{{lng}}/{{ns}}.json`,
  },
}
