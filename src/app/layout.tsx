import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import './globals.css'
import { I18nProvider } from '@/components/i18n-provider'
import { Providers } from '@/components/providers'

// Headings only — body/UI text stays on the system stack, per the design
// handoff. Self-hosted by next/font at build time rather than pulled from
// Google's CDN at runtime: no third-party request from the visitor's browser,
// and no layout shift while the face loads.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Sports Event Manager',
  description: 'Plan and execute your sport event',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-white text-foreground">
        <Providers>
          <I18nProvider>{children}</I18nProvider>
        </Providers>
      </body>
    </html>
  )
}
