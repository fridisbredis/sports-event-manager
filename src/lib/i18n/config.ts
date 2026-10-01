import type { InitOptions } from 'i18next'

export const defaultNS = 'common'
export const locales = ['en', 'sv'] as const
export const defaultLocale = 'sv'

// Deliberately not defaultLocale: Swedish is what users see, but English is the
// complete set. If a Swedish key is ever missing, falling back to English shows
// real text instead of a raw key name like "admin.dashboard.title".
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
