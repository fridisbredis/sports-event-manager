'use client'

import { useTranslation } from '@/lib/i18n/client'

/**
 * Error boundary scoped to the official surfaces.
 *
 * Without this, a throw in any official page bubbles to src/app/error.tsx,
 * which replaces the whole document — including the BottomTabBar from
 * (official)/[tenantSlug]/layout.tsx. An official whose schedule query failed
 * would land on a full-screen error with no navigation, on a phone, on event
 * day, with the browser back button as the only way out.
 *
 * Placed beside the layout rather than inside each page so it renders *within*
 * the layout: the tab bar stays, and a broken query becomes a broken tab
 * rather than a broken app. Reaching Home, Info or Announcements is often
 * enough to get through the day.
 *
 * Mobile-first on purpose (see AGENTS.md: official screens are mobile-first),
 * so the copy is short and the touch target is large.
 */
export default function OfficialError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gray-400">
        {t('errorPage.eyebrow')}
      </p>

      <div className="mt-6 h-px w-12 bg-gray-200" />

      <h1 className="mt-6 text-lg font-medium text-gray-900">{t('errorPage.heading')}</h1>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-gray-500">{t('errorPage.body')}</p>

      <button
        onClick={reset}
        className="mt-8 min-h-11 px-6 text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-gray-900"
      >
        {t('errorPage.cta')}
      </button>

      <p className="mt-10 text-xs text-gray-400">{t('errorPage.navHint')}</p>
    </div>
  )
}
