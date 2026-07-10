import { Space_Grotesk } from 'next/font/google'
import Link from 'next/link'
import { getServerTranslation } from '@/lib/i18n/server'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['300', '500'], variable: '--font-display' })

export default async function NotFound() {
  const t = await getServerTranslation('en')

  return (
    <main
      className={`${display.variable} flex min-h-screen flex-col items-center justify-center bg-white px-6 py-24 text-center`}
      style={{ fontFamily: 'var(--font-display)' }}
    >
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gray-400">
        {t('notFoundPage.eyebrow')}
      </p>

      <p className="mt-6 text-[120px] font-light leading-none tracking-tight text-gray-900 sm:text-[160px]">
        404
      </p>

      <div className="mt-8 h-px w-16 bg-gray-200" />

      <h1 className="mt-8 text-xl font-medium text-gray-900">{t('notFoundPage.heading')}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">{t('notFoundPage.body')}</p>

      <Link
        href="/"
        className="mt-10 text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-gray-900"
      >
        {t('notFoundPage.cta')}
      </Link>
    </main>
  )
}
