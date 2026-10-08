'use client'

import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { dateLocaleFor } from '@/lib/i18n/date-locale'
import { useLanguage } from '@/components/i18n-provider'

// React Aria takes weekday order and date format from this locale. Without it
// it falls back to the browser locale — en-US for most dev machines — which
// renders 9/10/2026 and Sunday-first calendars. Resolved from the same
// language as every toLocale*String call in the app so the pickers and the
// rendered dates can't disagree; see the helper's own file for why the
// region stays pinned while only the language half follows i18next.

export function Providers({ children }: { children: React.ReactNode }) {
  const language = useLanguage()

  return (
    <HeroUIProvider locale={dateLocaleFor(language)}>
      {children}
      <ToastProvider placement="top-right" toastProps={{ variant: 'flat', radius: 'md' }} />
    </HeroUIProvider>
  )
}
