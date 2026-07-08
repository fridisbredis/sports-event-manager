import { useTranslation as useTranslationBase } from 'react-i18next'
import { defaultNS, locales } from './config'

export function useTranslation(ns?: string) {
  return useTranslationBase(ns || defaultNS)
}

export type Locale = (typeof locales)[number]
