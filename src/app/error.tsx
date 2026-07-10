'use client'

import { Space_Grotesk } from 'next/font/google'
import { useTranslation } from '@/lib/i18n/client'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['300', '500'], variable: '--font-display' })

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useTranslation('common')

  return (
    <main
      className={`${display.variable} flex min-h-screen flex-col items-center justify-center bg-white px-6 py-24 text-center`}
      style={{ fontFamily: 'var(--font-display)' }}
    >
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gray-400">{t('errorPage.eyebrow')}</p>

      <div className="mt-8 h-px w-16 bg-gray-200" />

      <h1 className="mt-8 text-xl font-medium text-gray-900">{t('errorPage.heading')}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">{t('errorPage.body')}</p>

      <button
        onClick={reset}
        className="mt-10 text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-gray-900"
      >
        {t('errorPage.cta')}
      </button>
    </main>
  )
}
