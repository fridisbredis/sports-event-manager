import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SkeletonRows } from '../_components/skeleton-rows'

// Shown while HOME-01 renders on the server.
//
// The greeting is a placeholder rather than real text: unlike the other tabs,
// this page's heading is the official's own name, which is exactly what is
// still being fetched. Rendering a guess and swapping it would flicker.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div className="px-5 pt-10 pb-6">
      <div aria-hidden="true" className="mb-8">
        <div className="h-7 w-52 rounded-md bg-surface" />
        <div className="mt-2 h-4 w-36 rounded-md bg-surface" />
      </div>

      {/* The section label is fixed copy, so it is real. The four nav cards
          below it are always four, whatever the data says — they are routes,
          not rows — which makes this the one tab whose placeholder count is
          exact rather than typical. */}
      <p className="section-label mb-3">{t('home.goTo')}</p>
      <SkeletonRows label={t('nav.loading')} rows={4} height="h-[4.75rem]" />
    </div>
  )
}
