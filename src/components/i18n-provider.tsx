'use client'

import { ReactNode } from 'react'
import i18next from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { i18nConfig, defaultLocale } from '@/lib/i18n/config'

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

if (!i18next.isInitialized) {
  i18next
    .use(initReactI18next)
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        return resources[language]?.[namespace] ?? {}
      })
    )
    .init({
      ...i18nConfig,
      react: {
        useSuspense: false, // Disable suspense in case of missing translations
      },
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
    })
}

interface I18nProviderProps {
  children: ReactNode
  language?: string
}

export function I18nProvider({ children, language = defaultLocale }: I18nProviderProps) {
  if (language && language !== i18next.language) {
    i18next.changeLanguage(language)
  }

  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
}
