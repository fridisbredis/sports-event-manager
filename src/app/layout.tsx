import type { Metadata } from 'next'
import './globals.css'
import { heading } from '@/fonts/manrope'
import { I18nProvider } from '@/components/i18n-provider'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: 'Sports Event Manager',
  description: 'Plan and execute your sport event',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved here as well as in the pages below so that `lang` on <html> and
  // the client-side i18next instance both start in the user's own language.
  // Memoised per render pass, so this shares one lookup with every page and
  // layout beneath it rather than adding a query.
  //
  // `lang` is not cosmetic: it is what screen readers switch pronunciation on,
  // and what tells a browser's translate prompt the page is not already in the
  // reader's language. Date formatting deliberately does NOT follow it — see
  // src/lib/i18n/date-locale.ts.
  const language = await getUserLanguage()

  return (
    <html lang={language} className={heading.variable}>
      <body className="bg-white text-foreground">
        <Providers>
          <I18nProvider language={language}>{children}</I18nProvider>
        </Providers>
      </body>
    </html>
  )
}
