import { publishEvent } from '@/lib/actions/publish-event'
import { getServerTranslation } from '@/lib/i18n/server'
import { PublishButton } from './publish-button'
import { SectionCard } from './section-card'

interface PublishSectionProps {
  canPublish: boolean
  isPublished: boolean
  hasName: boolean
  hasRaceStage: boolean
  tenantSlug: string
  tenantId: string
  eventId: string
}

export async function PublishSection({
  canPublish,
  isPublished,
  hasName,
  hasRaceStage,
  tenantSlug,
  tenantId,
  eventId,
}: PublishSectionProps) {
  const t = await getServerTranslation('en', 'admin')

  async function handlePublish() {
    'use server'
    await publishEvent({ tenantSlug, tenantId, eventId })
  }

  return (
    <SectionCard>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
        {t('dashboard.publishStatus')}
      </h2>
      {isPublished ? (
        <p className="text-sm text-gray-700">{t('dashboard.publishedVisible')}</p>
      ) : canPublish ? (
        <>
          <p className="text-sm text-gray-700 mb-5">{t('dashboard.draftNotVisible')}</p>
          <form action={handlePublish}>
            <PublishButton type="submit">{t('dashboard.publishEvent')}</PublishButton>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-4">{t('dashboard.cannotPublish')}</p>
          <ul className="space-y-2.5 mb-5">
            {!hasName && <MissingItem label={t('dashboard.requiredEventName')} />}
            {!hasRaceStage && <MissingItem label={t('dashboard.requiredStage')} />}
          </ul>
          <PublishButton type="button" disabled>
            {t('dashboard.publishEvent')}
          </PublishButton>
        </>
      )}
    </SectionCard>
  )
}

function MissingItem({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm text-gray-500">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold leading-none select-none">
        i
      </span>
      {label}
    </li>
  )
}
