import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonList } from '../_components/admin-skeleton'

// Shown while the workstations screen renders on the server.
//
// The real screen is a split accordion, one panel per stage, so the
// placeholder is a short stack of tall panels rather than table rows.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <h1 className="page-title mb-6">{t('workstations.title')}</h1>
      <SkeletonList rows={4} height="h-20" />
    </div>
  )
}
