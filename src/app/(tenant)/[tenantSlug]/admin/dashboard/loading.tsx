import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import {
  AdminLoadingStatus,
  SkeletonHeader,
  SkeletonList,
  SkeletonTiles,
} from '../_components/admin-skeleton'

// Shown while the dashboard renders on the server. One of the heavier
// screens: a cached RPC carrying the event, officials counts, race stages
// and scheduling warnings.
//
// Mirrors the page's three bands — the event header, the publish/officials
// card row, and the admin-area tiles — so the real content lands in a layout
// that has not moved.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <SkeletonHeader />
      {/* The publish card and the officials card, side by side at the page's
          own 3fr/2fr split. */}
      <div aria-hidden="true" className="mb-5 grid grid-cols-[3fr_2fr] gap-5">
        <div className="h-44 rounded-xl bg-white" />
        <div className="h-44 rounded-xl bg-white" />
      </div>
      <SkeletonList rows={1} height="h-32" />
      <div className="mt-5">
        <SkeletonTiles tiles={6} />
      </div>
    </div>
  )
}
