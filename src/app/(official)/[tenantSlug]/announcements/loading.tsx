import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SkeletonRows } from '../_components/skeleton-rows'

// Shown while ANN-01 renders on the server.
//
// Four rows rather than three: this list fills a page before it paginates,
// so a short placeholder would be followed by the content growing downwards.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('announcements.title')}</h1>
      <SkeletonRows label={t('nav.loading')} rows={4} height="h-[5rem]" />
    </div>
  )
}
