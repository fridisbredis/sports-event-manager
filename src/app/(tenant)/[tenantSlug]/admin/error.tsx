'use client'

import { useTranslation } from '@/lib/i18n/client'

/**
 * Error boundary scoped to the tenant admin surfaces.
 *
 * Same reasoning as (official)/[tenantSlug]/error.tsx: without this, a throw in
 * any admin page bubbles to src/app/error.tsx and replaces the whole document,
 * taking SidebarNav with it. One broken query would make the entire admin area
 * look down when six other sections still work.
 *
 * Less urgent than the official one — an admin is at a desk with a working back
 * button — but the same seven pages sit behind this layout, so keeping the nav
 * turns "the admin area is broken" into "this page is broken".
 *
 * Web-first here (AGENTS.md), so it can afford more vertical space than the
 * official variant.
 */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-gray-400">
        {t('errorPage.eyebrow')}
      </p>

      <div className="mt-8 h-px w-16 bg-gray-200" />

      <h1 className="mt-8 text-xl font-medium text-gray-900">{t('errorPage.heading')}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-gray-500">{t('errorPage.body')}</p>

      <button
        onClick={reset}
        className="mt-10 text-sm font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:decoration-gray-900"
      >
        {t('errorPage.cta')}
      </button>
    </div>
  )
}
