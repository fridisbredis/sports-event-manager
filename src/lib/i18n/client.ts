import { useTranslation as useTranslationBase } from 'react-i18next'
import { defaultNS } from './config'

export function useTranslation(ns?: string) {
  return useTranslationBase(ns || defaultNS)
}

// Re-exported from ./config so client components can keep importing it
// from here; the canonical declaration sits next to `locales` itself, where
// server-only modules can reach it without pulling in react-i18next.
export type { Locale } from './config'
