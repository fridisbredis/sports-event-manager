import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonForm } from '../../_components/admin-skeleton'

// Shown while the new-workstation form renders on the server.
//
// Two columns at the form's own split: the fields on the left, the
// already-used colours preview on the right.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <div className="mb-8 flex items-center justify-between">
        <h1 className="page-title">{t('workstations.addTitle')}</h1>
        <div aria-hidden="true" className="h-10 w-24 rounded-large bg-white" />
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]">
        <SkeletonForm fields={5} />
        <SkeletonForm fields={1} />
      </div>
    </div>
  )
}
