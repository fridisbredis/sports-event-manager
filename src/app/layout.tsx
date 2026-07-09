import type { Metadata } from 'next'
import './globals.css'
import { I18nProvider } from '@/components/i18n-provider'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Sports Event Manager',
  description: 'Plan and execute your sport event',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <I18nProvider>{children}</I18nProvider>
        </Providers>
      </body>
    </html>
  )
}
