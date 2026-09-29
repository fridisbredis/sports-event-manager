'use client'

import { HeroUIProvider, ToastProvider } from '@heroui/react'

// The UI language is English (see src/lib/i18n/config.ts), but date and
// calendar conventions are regional, not linguistic: the users are Swedish and
// expect weeks to start on Monday and dates written the Swedish way
// (YYYY-MM-DD). React Aria takes both from this locale, so it is pinned to
// sv-SE independently of the i18next language. Without it React Aria falls
// back to the browser locale — en-US for most dev machines — which renders
// 9/10/2026 and Sunday-first calendars.
const DATE_LOCALE = 'sv-SE'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider locale={DATE_LOCALE}>
      {children}
      <ToastProvider placement="top-right" toastProps={{ variant: 'flat', radius: 'md' }} />
    </HeroUIProvider>
  )
}
