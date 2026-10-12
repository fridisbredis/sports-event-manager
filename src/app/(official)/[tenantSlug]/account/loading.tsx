import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SkeletonRows } from '../_components/skeleton-rows'

// Shown while ACCT-01 renders on the server.
//
// The heading keeps the page's own split — padding without the bottom inset,
// because the form below supplies its own — so the title does not move when
// the real page replaces this.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div>
      <div className="px-5 pt-10">
        <h1 className="page-title">{t('account.title')}</h1>
      </div>
      {/* Form sections rather than list rows: taller blocks, fewer of them. */}
      <div className="px-5 pt-6 pb-6">
        <SkeletonRows label={t('nav.loading')} rows={3} height="h-24" />
      </div>
    </div>
  )
}
