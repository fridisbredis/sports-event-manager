import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SkeletonRows } from '../_components/skeleton-rows'
import { SectionLabel } from './_components/section-label'

// Shown while INFO-01 renders on the server.
//
// Mirrors the page's three bands: the event header card, the programme list,
// and the facilities row. The headings are real — they are fixed copy, the
// same on every tenant's event — so only what varies is drawn as a
// placeholder.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('eventInfo.title')}</h1>

      {/* Taller than a programme row: this card carries the logo, the event
          name, its type and a description paragraph. */}
      <div aria-hidden="true" className="mb-6 h-[7.5rem] w-full rounded-xl bg-surface" />

      <div className="mb-8">
        <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
        <SkeletonRows label={t('nav.loading')} rows={2} height="h-[5.5rem]" />
      </div>

      {/* Chips, not cards — a wrapped row of short pills, so the placeholder
          is a row of short pills too. */}
      <div>
        <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((chip) => (
            <div key={chip} className="h-8 w-24 rounded-full bg-surface" />
          ))}
        </div>
      </div>
    </div>
  )
}
