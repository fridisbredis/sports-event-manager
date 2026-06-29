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

// Initialize i18next once on the client
if (!i18next.isInitialized) {
  i18next
    .use(initReactI18next)
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        // Fallback for any missing files
        if (language === 'en') {
          if (namespace === 'common') return enCommon
          if (namespace === 'auth') return enAuth
          if (namespace === 'admin') return enAdmin
          if (namespace === 'official') return enOfficial
        }
        return {}
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
