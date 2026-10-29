import { publishEvent } from '@/lib/actions/publish-event'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { PublishButton } from './publish-button'
import { SectionCard } from './section-card'

interface PublishSectionProps {
  canPublish: boolean
  isPublished: boolean
  hasName: boolean
  hasRaceStage: boolean
  tenantSlug: string
  tenantId: string
  eventId: string | null
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
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  async function handlePublish() {
    'use server'
    if (!eventId) return
    await publishEvent({ tenantSlug, tenantId, eventId })
  }

  return (
    <SectionCard className={isPublished ? 'card-accent-success' : undefined}>
      <h2 className="section-label mb-4">{t('dashboard.publishStatus')}</h2>
      {isPublished ? (
        <p className="flex items-center gap-2.5 text-[15px] text-ink-soft">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-ok-dot ring-[3px] ring-status-ok-bg"
          />
          {t('dashboard.publishedVisible')}
        </p>
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
