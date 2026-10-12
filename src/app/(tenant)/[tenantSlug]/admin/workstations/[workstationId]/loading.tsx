import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonForm } from '../../_components/admin-skeleton'

// Shown while the workstation edit form renders on the server.
//
// The same two-column shape as the new-workstation screen, which is what the
// edit form reuses. The heading is a placeholder rather than real text: this
// screen titles itself with the workstation's own name, which is exactly what
// is still being fetched.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <div aria-hidden="true" className="mb-8 flex items-center justify-between">
        <div className="h-8 w-64 rounded-lg bg-white" />
        <div className="h-10 w-24 rounded-large bg-white" />
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]">
        <SkeletonForm fields={5} />
        <SkeletonForm fields={1} />
      </div>
    </div>
  )
}
