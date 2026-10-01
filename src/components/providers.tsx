'use client'

import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { DATE_LOCALE } from '@/lib/i18n/date-locale'

// React Aria takes weekday order and date format from this locale. Without it
// it falls back to the browser locale — en-US for most dev machines — which
// renders 9/10/2026 and Sunday-first calendars. Shared with every
// toLocale*String call in the app so the pickers and the rendered dates can't
// disagree; see the constant's own file for why it is separate from the
// i18next language.

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider locale={DATE_LOCALE}>
      {children}
      <ToastProvider placement="top-right" toastProps={{ variant: 'flat', radius: 'md' }} />
    </HeroUIProvider>
  )
}
