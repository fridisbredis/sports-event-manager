import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonList } from '../_components/admin-skeleton'

// Shown while the communication screen renders on the server.
//
// Mirrors its two bands: the composer card, then the timeline of sent
// announcements.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="page-title">{t('communication.title')}</h1>
        {/* The two channel pills — participants and officials. */}
        <div aria-hidden="true" className="flex gap-2">
          <div className="h-10 w-32 rounded-full bg-white" />
          <div className="h-10 w-32 rounded-full bg-white" />
        </div>
      </div>
      <div aria-hidden="true" className="mb-6 h-40 w-full rounded-xl bg-white" />
      <SkeletonList rows={3} height="h-20" />
    </div>
  )
}
