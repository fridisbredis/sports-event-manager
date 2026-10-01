'use client'

import { ReactNode, createContext, useContext, useEffect } from 'react'
import i18next, { createInstance, type i18n as I18nInstance } from 'i18next'
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
// these.
//
// On the client this is the shared singleton, created once per browser session:
// there is exactly one user, the switcher mutates it with changeLanguage(), and
// every subscribed component re-renders off that.
//
// On the SERVER it must be a fresh instance per render. `i18next` is a
// module-level object shared by the whole Node process, not scoped to a
// request, so initialising it or changing its language leaks across users:
// once a signed-in Swedish user had rendered, the same /login served Swedish to
// everyone after them until the process restarted, while the client — with no
// stored preference — hydrated in English. That surfaced as a hydration
// mismatch, but the underlying fault is worse than a mismatch: one user's
// language decided what the next user's server render said.
//
// react-i18next reads the instance from I18nextProvider's context, so handing
// the server a private instance is enough — the components calling
// useTranslation() need no change.
function configure(instance: I18nInstance, language: string) {
  instance
    .use(initReactI18next)
    .use(
      resourcesToBackend((lng: string, namespace: string) => {
        return resources[lng]?.[namespace] ?? {}
      })
    )
    .init({
      ...i18nConfig,
      lng: language,
      // Load the bundled resources during init() rather than on a later tick.
      // The resources are statically imported objects, so there is nothing to
      // wait for — but left at its default i18next defers them, and a server
      // render (which gets no second tick) would emit raw keys like
      // "language.label" instead of the translated string.
      initImmediate: false,
      react: {
        useSuspense: false, // Disable suspense in case of missing translations
      },
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
    })

  return instance
}

// `typeof window` rather than a build-time flag: this one module is shared by
// both halves, and the branch has to hold at runtime.
const isServer = typeof window === 'undefined'

function instanceFor(language: string): I18nInstance {
  // A private instance per render, and never initReactI18next on the shared
  // singleton — see above. init() is synchronous for statically bundled
  // resources, so this builds an object graph rather than doing any I/O.
  if (isServer) return configure(createInstance(), language)

  if (!i18next.isInitialized) configure(i18next, language)
  return i18next
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
  // fallback language first. Idempotent on the client after the first call; on
  // the server it is a fresh instance each time, which is the point.
  const instance = instanceFor(language)

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
  //
  // Effects do not run on the server, so this only ever touches the client
  // instance — but it reads `instance` rather than the imported singleton so
  // that stays true by construction rather than by coincidence.
  useEffect(() => {
    if (language && language !== instance.language) {
      instance.changeLanguage(language)
    }
  }, [instance, language])

  // Narrowed rather than cast: `language` is a plain string on this prop for
  // callers that read it out of the database, and an unrecognised value must
  // land on the same default the server used, not be published as a Locale.
  const resolved: Locale = isLocale(language) ? language : defaultLocale

  return (
    <LanguageContext.Provider value={resolved}>
      <I18nextProvider i18n={instance}>{children}</I18nextProvider>
    </LanguageContext.Provider>
  )
}
