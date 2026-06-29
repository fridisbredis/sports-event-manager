import { useTranslation as useTranslationBase, UseTranslationResponse } from 'react-i18next'
import { defaultNS, locales } from './config'

/**
 * Client-side translation hook.
 * Usage: const { t } = useTranslation()
 *        const text = t('key.subkey')
 */
export function useTranslation(ns?: string) {
  return useTranslationBase(ns || defaultNS)
}

export type Locale = (typeof locales)[number]
