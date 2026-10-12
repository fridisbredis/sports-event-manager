import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { AdminLoadingStatus, SkeletonList } from '../_components/admin-skeleton'

// Shown while the officials roster renders on the server.
//
// The title is real text — it is the same on every tenant — and the Add
// button beside it is drawn as a placeholder rather than a working control,
// since a button that does nothing is worse than one that arrives a moment
// later.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  return (
    <div className="px-8 py-8">
      <AdminLoadingStatus label={t('navigation.loading')} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="page-title">{t('officials.title')}</h1>
        <div aria-hidden="true" className="h-10 w-32 rounded-large bg-white" />
      </div>
      {/* A table, so rows rather than cards: one card surface with rows
          inside it, matching how the real table is wrapped. */}
      <div aria-hidden="true" className="rounded-xl bg-white p-4">
        <SkeletonList rows={6} height="h-12" />
      </div>
    </div>
  )
}
