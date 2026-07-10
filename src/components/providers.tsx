'use client'

import { HeroUIProvider, ToastProvider } from '@heroui/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      {children}
      <ToastProvider placement="top-right" toastProps={{ variant: 'flat', radius: 'md' }} />
    </HeroUIProvider>
  )
}
