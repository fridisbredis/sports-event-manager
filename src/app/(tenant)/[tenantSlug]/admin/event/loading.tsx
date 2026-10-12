import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonForm } from '../_components/admin-skeleton'

// Shown while the event configuration renders on the server.
//
// Two columns at the page's own split: the event form on the left, the
// stages editor on the right.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <div className="mb-8 flex items-center justify-between">
        <h1 className="page-title">{t('eventConfig.title')}</h1>
        {/* The publish/draft pill and the two action buttons. */}
        <div aria-hidden="true" className="flex items-center gap-3">
          <div className="h-7 w-20 rounded-full bg-white" />
          <div className="h-10 w-24 rounded-large bg-white" />
          <div className="h-10 w-24 rounded-large bg-white" />
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]">
        <SkeletonForm fields={6} />
        <SkeletonForm fields={3} />
      </div>
    </div>
  )
}
