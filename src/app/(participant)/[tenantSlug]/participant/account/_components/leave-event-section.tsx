'use client'

import { useRef, useState } from 'react'
import ConfirmDialog from '@/components/confirm-dialog'
import { AppCard } from '@/components/ui/app-card'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { leaveParticipantEvent } from '../actions'

export interface LeavableEvent {
  eventId: string
  eventName: string
}

interface Props {
  tenantSlug: string
  events: LeavableEvent[]
}

// N74: the participant leaves an event they are entered in. One row per event,
// near the bottom of Account with the other things that end something (log
// out), not inside My race: a race card with nothing imported yet is hidden
// there, and its event must still be leavable.
//
// The copy says what this is NOT: leaving removes the event from the app, it
// does not withdraw the race entry in Race Results.
export function LeaveEventSection({ tenantSlug, events }: Props) {
  const { t } = useTranslation('official')
  const [leaving, setLeaving] = useState<LeavableEvent | null>(null)
  // ConfirmDialog has no pending state of its own; a second tap on its button
  // while the first is still on its way must not send a second request.
  const inFlight = useRef(false)

  if (events.length === 0) return null

  async function handleConfirm() {
    if (!leaving || inFlight.current) return
    inFlight.current = true
    // On success the action redirects, so this resolves only with an error.
    const result = await leaveParticipantEvent({ tenantSlug, eventId: leaving.eventId })
    inFlight.current = false
    setLeaving(null)
    if (result?.error) toastError(result.error)
  }

  return (
    <>
      <p className="section-label mb-2.5">{t('participant.account.leaveHeading')}</p>
      <AppCard className="mb-8" bodyClassName="px-4 py-4">
        <p className="text-sm text-ink-muted">{t('participant.account.leaveHint')}</p>
        <ul className="mt-3 divide-y divide-edge">
          {events.map((event) => (
            <li key={event.eventId} className="flex items-center justify-between gap-4 py-2.5">
              <span className="min-w-0 truncate text-[15px] font-semibold text-ink">
                {event.eventName}
              </span>
              <button
                type="button"
                onClick={() => setLeaving(event)}
                aria-label={t('participant.account.leaveAria', { event: event.eventName })}
                className="shrink-0 rounded-control px-3 py-1.5 text-[15px] font-semibold text-destructive transition-colors hover:bg-destructive/5"
              >
                {t('participant.account.leave')}
              </button>
            </li>
          ))}
        </ul>
      </AppCard>

      <ConfirmDialog
        open={leaving !== null}
        onCancel={() => setLeaving(null)}
        onConfirm={handleConfirm}
        title={t('participant.account.leaveConfirmTitle', { event: leaving?.eventName ?? '' })}
        body={t('participant.account.leaveConfirmBody')}
        confirmLabel={t('participant.account.leaveConfirm')}
        cancelLabel={t('participant.account.leaveCancel')}
        destructive
      />
    </>
  )
}
