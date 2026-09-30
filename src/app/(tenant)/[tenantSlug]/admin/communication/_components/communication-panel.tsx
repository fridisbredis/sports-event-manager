'use client'

import { Megaphone } from 'lucide-react'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { toastError, extractErrorMessage } from '@/lib/toast'
import type { Announcement, AnnouncementChannel } from '@/types/app'
import { DATE_LOCALE } from '@/lib/i18n/date-locale'

type ByChannel<T> = Record<AnnouncementChannel, T>

interface Props {
  tenantId: string
  page: number
  announcements: ByChannel<Announcement[]>
  hasMore: ByChannel<boolean>
}

/**
 * What the guard dialog is holding back. The channel toggle is local state and
 * stays instant; only a page change is a navigation, and both can lose an
 * unpublished draft, so both go through the same three-way prompt.
 */
type PendingAction =
  | { type: 'channel'; channel: AnnouncementChannel }
  | { type: 'page'; page: number }

const NO_PUBLISHED: ByChannel<Announcement[]> = { participants: [], officials: [] }

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

interface GuardDialogProps {
  open: boolean
  title: string
  body: string
  cancelLabel: string
  discardLabel: string
  publishLabel: string
  publishingLabel: string
  publishing: boolean
  onCancel: () => void
  onDiscard: () => void
  onPublish: () => void
}

function AnnouncementGuardDialog({
  open,
  title,
  body,
  cancelLabel,
  discardLabel,
  publishLabel,
  publishingLabel,
  publishing,
  onCancel,
  onDiscard,
  onPublish,
}: GuardDialogProps) {
  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-500 leading-relaxed">{body}</p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose} isDisabled={publishing}>
                {cancelLabel}
              </Button>
              <Button variant="light" onPress={onDiscard} isDisabled={publishing}>
                {discardLabel}
              </Button>
              <Button color="primary" onPress={onPublish} isLoading={publishing}>
                {publishing ? publishingLabel : publishLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export function CommunicationPanel({ tenantId, page, announcements: initial, hasMore }: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()

  const [channel, setChannel] = useState<AnnouncementChannel>('participants')
  const [draft, setDraft] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  // Only the optimistically-published rows live in state; the server payload is
  // read straight from props. Copying `initial` into state would seed it once on
  // mount and never again — paging is a soft navigation that re-renders the
  // server component and hands this same instance new props, so the list would
  // stay frozen on whichever page mounted first.
  const [published, setPublished] = useState<ByChannel<Announcement[]>>(NO_PUBLISHED)

  // `initial` changes identity only when a new server payload arrives. That
  // payload already contains anything we published, so the optimistic rows are
  // dropped at the same moment to avoid showing them twice.
  const [renderedPayload, setRenderedPayload] = useState(initial)
  if (renderedPayload !== initial) {
    setRenderedPayload(initial)
    setPublished(NO_PUBLISHED)
  }

  const isFirstPage = page === 1
  const isDirty = draft.trim().length > 0

  const performAction = useCallback(
    (action: PendingAction) => {
      if (action.type === 'channel') {
        setChannel(action.channel)
        return
      }
      router.push(`?page=${action.page}`)
    },
    [router]
  )

  const requestAction = useCallback(
    (action: PendingAction) => {
      if (action.type === 'channel' && action.channel === channel) return
      if (isDirty) {
        setPendingAction(action)
        return
      }
      performAction(action)
    },
    [channel, isDirty, performAction]
  )

  const publish = useCallback(
    async (targetChannel: AnnouncementChannel, body: string): Promise<boolean> => {
      setPublishing(true)
      try {
        const res = await fetch('/api/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, channel: targetChannel, body }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toastError(extractErrorMessage(body, t('communication.publishError')))
          return false
        }
        // The new announcement is the newest, so it only belongs on page 1 —
        // on any other page the prepend would put it in the wrong place. The
        // caller navigates back to page 1 instead.
        if (isFirstPage) {
          const newEntry: Announcement = {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            channel: targetChannel,
            body,
            sms_sent: false,
            published_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          }
          setPublished((prev) => ({
            ...prev,
            [targetChannel]: [newEntry, ...prev[targetChannel]],
          }))
        }
        return true
      } finally {
        setPublishing(false)
      }
    },
    [tenantId, t, isFirstPage]
  )

  const handlePublish = useCallback(async () => {
    if (!isDirty || publishing) return
    const ok = await publish(channel, draft.trim())
    if (!ok) return
    setDraft('')
    if (!isFirstPage) router.push('?page=1')
  }, [channel, draft, isDirty, isFirstPage, publish, publishing, router])

  const handleGuardCancel = useCallback(() => setPendingAction(null), [])

  const handleGuardDiscard = useCallback(() => {
    const action = pendingAction!
    setPendingAction(null)
    setDraft('')
    performAction(action)
  }, [pendingAction, performAction])

  const handleGuardPublish = useCallback(async () => {
    const action = pendingAction!
    const ok = await publish(channel, draft.trim())
    if (!ok) return
    setPendingAction(null)
    setDraft('')
    // The requested navigation wins over publish's own hop back to page 1 —
    // the user asked to go somewhere specific.
    performAction(action)
  }, [channel, draft, pendingAction, performAction, publish])

  const filtered = published[channel].length
    ? [...published[channel], ...initial[channel]]
    : initial[channel]
  const channelHasMore = hasMore[channel]

  const timelineLabel =
    channel === 'participants'
      ? t('communication.timelineParticipants')
      : t('communication.timelineOfficials')

  return (
    <>
      <div className="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="page-title">{t('communication.title')}</h1>
        </div>

        {/* Channel toggle */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm text-ink-soft">{t('communication.channel')}</span>
          <div className="flex gap-1">
            {(['participants', 'officials'] as AnnouncementChannel[]).map((ch) => (
              <Button
                key={ch}
                type="button"
                onPress={() => requestAction({ type: 'channel', channel: ch })}
                color={channel === ch ? 'primary' : 'default'}
                variant={channel === ch ? 'solid' : 'bordered'}
                size="sm"
                radius="full"
                // The unselected pill is white with a light edge and ink
                // text; HeroUI's own `bordered` default is grey on grey and
                // reads as disabled next to the filled one. `rounded-full`
                // is restated because the solid branch of this same Button
                // gets `rounded-control` from the wrapper.
                className={
                  channel === ch
                    ? '!rounded-full px-5 font-semibold'
                    : '!rounded-full border-edge bg-white px-5 font-semibold text-ink'
                }
              >
                {t(`communication.${ch}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* New announcement card */}
        <AppCard className="card-accent-primary mb-6" bodyClassName="p-5">
          <p className="section-label mb-3">{t('communication.newAnnouncement')}</p>
          <Textarea
            value={draft}
            onValueChange={setDraft}
            placeholder={t('communication.announcementPlaceholder')}
            minRows={4}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-[13px] text-ink-muted">{t('communication.smsNote')}</span>
            <Button
              type="button"
              color="primary"
              onPress={handlePublish}
              isDisabled={!isDirty}
              isLoading={publishing}
            >
              {publishing ? t('communication.publishing') : t('communication.publish')}
            </Button>
          </div>
        </AppCard>

        {/* Timeline */}
        <div>
          <p className="section-label mb-3">{timelineLabel}</p>

          {filtered.length === 0 ? (
            isFirstPage ? (
              <EmptyStateCard
                Icon={Megaphone}
                title={t('communication.noAnnouncementsYet')}
                description={t('communication.noAnnouncementsHint')}
              />
            ) : (
              // One ?page= drives both channels, so a channel with fewer
              // announcements than the other runs out first. That is not
              // "nothing published" — say so, and offer the way back.
              <EmptyStateCard Icon={Megaphone} title={t('communication.noOlderAnnouncements')}>
                <Button
                  type="button"
                  variant="light"
                  size="sm"
                  onPress={() => requestAction({ type: 'page', page: 1 })}
                >
                  {t('communication.backToNewest')}
                </Button>
              </EmptyStateCard>
            )
          ) : (
            /* Each announcement is its own card with a leading accent edge
               rather than rows inside one divided card — the reference reads
               them as separate published items, not as a table. */
            <div className="space-y-3">
              {filtered.map((a) => (
                <AppCard key={a.id} className="card-accent-left" bodyClassName="px-5 py-4">
                  <p className="text-[15px] leading-snug text-ink">{a.body}</p>
                  <p className="mt-1 text-sm text-ink-label">{formatDate(a.published_at)}</p>
                </AppCard>
              ))}
            </div>
          )}

          {(!isFirstPage || channelHasMore) && (
            <nav className="flex items-center justify-between gap-3 mt-4">
              {isFirstPage ? (
                <span />
              ) : (
                <Button
                  type="button"
                  variant="light"
                  size="sm"
                  onPress={() => requestAction({ type: 'page', page: page - 1 })}
                >
                  {t('communication.newer')}
                </Button>
              )}
              {channelHasMore && (
                <Button
                  type="button"
                  variant="light"
                  size="sm"
                  onPress={() => requestAction({ type: 'page', page: page + 1 })}
                >
                  {t('communication.older')}
                </Button>
              )}
            </nav>
          )}
        </div>
      </div>

      {/* Unsaved-changes guard */}
      <AnnouncementGuardDialog
        open={pendingAction !== null}
        title={t('communication.unsavedTitle')}
        body={t('communication.unsavedBody')}
        cancelLabel={t('communication.cancel')}
        discardLabel={t('communication.discardAndContinue')}
        publishLabel={t('communication.publish')}
        publishingLabel={t('communication.publishing')}
        publishing={publishing}
        onCancel={handleGuardCancel}
        onDiscard={handleGuardDiscard}
        onPublish={handleGuardPublish}
      />
    </>
  )
}
