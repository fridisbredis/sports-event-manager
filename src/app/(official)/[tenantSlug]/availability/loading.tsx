import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SkeletonRows } from '../_components/skeleton-rows'

// Shown while the availability screen renders on the server.
//
// The heading mirrors this page's own markup rather than the app's
// `.page-title`: this screen states its title with text-2xl, and matching the
// page is what keeps the swap still. (If that heading is ever brought in line
// with the other tabs, this should follow it.)
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div>
      <div className="px-5 pt-10 pb-2">
        <h1 className="text-2xl font-bold text-foreground">{t('availability.pageTitle')}</h1>
      </div>
      <div className="px-5 pb-6">
        <SkeletonRows label={t('nav.loading')} rows={3} height="h-20" />
      </div>
    </div>
  )
}
