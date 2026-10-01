'use client'

import { ReactNode, createContext, useContext, useEffect } from 'react'
import i18next from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { i18nConfig, defaultLocale, locales, type Locale } from '@/lib/i18n/config'

// Import all translation files statically for better bundling
import enCommon from '../../public/locales/en/common.json'
import enAuth from '../../public/locales/en/auth.json'
import enAdmin from '../../public/locales/en/admin.json'
import enOfficial from '../../public/locales/en/official.json'
import svCommon from '../../public/locales/sv/common.json'
import svAuth from '../../public/locales/sv/auth.json'
import svAdmin from '../../public/locales/sv/admin.json'
import svOfficial from '../../public/locales/sv/official.json'

const resources: Record<string, Record<string, unknown>> = {
  en: {
    common: enCommon,
    auth: enAuth,
    admin: enAdmin,
    official: enOfficial,
  },
  sv: {
    common: svCommon,
    auth: svAuth,
    admin: svAdmin,
    official: svOfficial,
  },
}

// Seeded with the language the server rendered in, so the very first paint is
// already correct. init() is synchronous for statically bundled resources like
// these, and runs once per browser session — subsequent changes go through the
// effect in the component below rather than re-initialising.
function ensureInitialized(language: string) {
  if (i18next.isInitialized) return

  i18next
    .use(initReactI18next)
    .use(
      resourcesToBackend((lng: string, namespace: string) => {
        return resources[lng]?.[namespace] ?? {}
      })
    )
    .init({
      ...i18nConfig,
      lng: language,
      react: {
        useSuspense: false, // Disable suspense in case of missing translations
      },
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
    })
}

// The language the server resolved for this render, published so client
// components can start from it rather than guessing.
//
// Without this, a client component that needs the current language as *state*
// (rather than just calling t()) had no way to reach it, and /login hardcoded
// defaultLocale instead. That disagreed with the strings around it, which come
// from the i18next instance seeded with the server's language — a signed-in
// Swedish user signing out got a page rendered in Swedish on the server and
// hydrated as English, which React reports as a hydration mismatch.
const LanguageContext = createContext<Locale>(defaultLocale)

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

/**
 * The language the current render is in — the signed-in user's stored
 * preference, or the default locale when they have not chosen one or are
 * signed out. Identical on the server and on the first client render, which is
 * what makes it safe to seed state with.
 */
export function useLanguage(): Locale {
  return useContext(LanguageContext)
}

interface I18nProviderProps {
  children: ReactNode
  language?: string
}

export function I18nProvider({ children, language = defaultLocale }: I18nProviderProps) {
  // Before the first render rather than in an effect: the strings below are
  // about to be read, and initialising afterwards would paint them in the
  // fallback language first. This is idempotent after the first call.
  ensureInitialized(language)

  // changeLanguage() is a side effect on a module-level singleton that other
  // components subscribe to, so calling it during render updates those
  // components mid-render — React rejects that ("Cannot update a component
  // while rendering a different one"), and it only showed up once a component
  // other than this one started reading i18next's language.
  //
  // The first language still has to be in place BEFORE the first render, or
  // every string would paint in the previous language and then swap. That is
  // handled by seeding `lng` at init() above, on the first render. This effect
  // covers what that cannot: a language
  // that changes afterwards, when the switcher saves and the route re-renders
  // with a new value from the server.
  useEffect(() => {
    if (language && language !== i18next.language) {
      i18next.changeLanguage(language)
    }
  }, [language])

  // Narrowed rather than cast: `language` is a plain string on this prop for
  // callers that read it out of the database, and an unrecognised value must
  // land on the same default the server used, not be published as a Locale.
  const resolved: Locale = isLocale(language) ? language : defaultLocale

  return (
    <LanguageContext.Provider value={resolved}>
      <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
    </LanguageContext.Provider>
  )
}
