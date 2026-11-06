import { publishEvent, unpublishEvent } from '@/lib/actions/publish-event'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { PublishButton, UnpublishButton } from './publish-button'
import { SectionCard } from './section-card'

interface PublishSectionProps {
  // PB5: the tenant's tier includes publishing (Premium and up).
  tierAllowsPublish: boolean
  // PB8: name and one Race stage are in place.
  canPublish: boolean
  // As the admin should see it (displayedEventStatus) — never true on Standard.
  isPublished: boolean
  hasName: boolean
  hasRaceStage: boolean
  tenantSlug: string
  tenantId: string
  eventId: string | null
}

// N36: publishing opens the participant side only (claim list and
// participant pages). Officials see the event in every state, which is what
// each state's copy says. The four states follow the EVT-01 wireframes:
// standard-tier, published, draft, publish-blocked-until-name+race-stage.
export async function PublishSection({
  tierAllowsPublish,
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

  async function handleUnpublish() {
    'use server'
    if (!eventId) return
    await unpublishEvent({ tenantSlug, tenantId, eventId })
  }

  return (
    <SectionCard className={isPublished ? 'card-accent-success' : undefined}>
      <h2 className="section-label mb-4">{t('dashboard.publishStatus')}</h2>
      {!tierAllowsPublish ? (
        // PB5: shown, greyed out, with the tier that unlocks it — not hidden,
        // so the admin can see what Premium would add.
        <>
          <p className="text-sm text-gray-700 mb-5">{t('dashboard.draftStandardTier')}</p>
          <div className="flex items-center gap-3">
            <PublishButton type="button" disabled>
              {t('dashboard.publishEvent')}
            </PublishButton>
            <span className="rounded-full bg-status-neutral-bg px-2.5 py-0.5 text-xs font-medium text-status-neutral-text">
              {t('dashboard.premiumBadge')}
            </span>
          </div>
        </>
      ) : isPublished ? (
        <>
          <p className="flex items-center gap-2.5 text-[15px] text-ink-soft mb-5">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-ok-dot ring-[3px] ring-status-ok-bg"
            />
            {t('dashboard.publishedVisible')}
          </p>
          <form action={handleUnpublish}>
            <UnpublishButton>{t('dashboard.unpublishEvent')}</UnpublishButton>
          </form>
        </>
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
