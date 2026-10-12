import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonGrid } from '../_components/admin-skeleton'

// Shown while the scheduling grid renders on the server.
//
// The heaviest screen in the app: stages, workstations with their operating
// windows, confirmed officials, plus a day's assignments and unavailability.
// It is also the one whose placeholder has to read as a grid rather than a
// list, because that is what replaces it.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      {/* The toolbar: stage and day selectors on the left, the by-person /
          by-work-area toggle on the right. */}
      <div aria-hidden="true" className="mb-6 flex items-center justify-between gap-4">
        <div className="flex gap-3">
          <div className="h-10 w-44 rounded-large bg-white" />
          <div className="h-10 w-36 rounded-large bg-white" />
        </div>
        <div className="h-10 w-56 rounded-large bg-white" />
      </div>
      <SkeletonGrid rows={7} columns={8} />
    </div>
  )
}
