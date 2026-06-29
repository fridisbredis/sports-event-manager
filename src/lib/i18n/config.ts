import type { InitOptions } from 'i18next'

export const defaultNS = 'common'
export const locales = ['en', 'sv'] as const
export const defaultLocale = 'en'

export const i18nConfig: InitOptions = {
  ns: [defaultNS, 'auth', 'admin', 'official'],
  defaultNS,
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  fallbackNS: defaultNS,
  interpolation: {
    escapeValue: false, // React escapes by default
  },
  backend: {
    loadPath: `/locales/{{lng}}/{{ns}}.json`,
  },
}
