import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonForm } from '../_components/admin-skeleton'

// Shown while the admin's own account screen renders on the server.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <h1 className="page-title mb-6">{t('navigation.account')}</h1>
      <SkeletonForm fields={4} />
    </div>
  )
}
