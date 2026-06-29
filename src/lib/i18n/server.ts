import { createInstance } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import { i18nConfig, defaultLocale } from './config'

// Pre-import all translation namespaces
import enCommon from '../../../public/locales/en/common.json'
import enAuth from '../../../public/locales/en/auth.json'
import enAdmin from '../../../public/locales/en/admin.json'
import enOfficial from '../../../public/locales/en/official.json'
import svCommon from '../../../public/locales/sv/common.json'

const translations = {
  en: {
    common: enCommon,
    auth: enAuth,
    admin: enAdmin,
    official: enOfficial,
  },
  sv: {
    common: svCommon,
    auth: svCommon, // Fallback to common for now
    admin: svCommon,
    official: svCommon,
  },
} as const

/**
 * Server-side i18next instance for SSR and API routes.
 * Creates a new instance per request to avoid shared state issues.
 */
async function initI18next(lng: string = defaultLocale, ns?: string) {
  const instance = createInstance()

  // Use resourcesToBackend to provide pre-loaded translations
  await instance
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        const lang = language as keyof typeof translations
        const nsKey = namespace as keyof (typeof translations)['en']
        return translations[lang]?.[nsKey] || {}
      })
    )
    .init({
      ...i18nConfig,
      lng,
      ns: ns ? [ns] : i18nConfig.ns,
      defaultNS: ns || i18nConfig.defaultNS, // Use passed namespace as default if provided
      returnEmptyString: false,
      saveMissing: false,
    })

  return instance
}

/**
 * Get translation function for server components.
 * Usage: const t = await getServerTranslation('en', 'admin')
 *        const text = t('dashboard.publishStatus')
 */
export async function getServerTranslation(lng: string = defaultLocale, ns?: string) {
  const i18n = await initI18next(lng, ns)
  return i18n.t.bind(i18n)
}
