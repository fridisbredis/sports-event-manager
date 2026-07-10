'use client'

import { useState, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import {
  Button,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@heroui/react'
import { toastError, extractErrorMessage } from '@/lib/toast'
import type { Announcement, AnnouncementChannel } from '@/types/app'

interface Props {
  tenantId: string
  announcements: Announcement[]
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
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
    <Modal isOpen={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody>
              <p className="text-sm text-default-500 leading-relaxed">{body}</p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="light"
                onPress={onClose}
                isDisabled={publishing}
              >
                {cancelLabel}
              </Button>
              <Button
                variant="light"
                onPress={onDiscard}
                isDisabled={publishing}
              >
                {discardLabel}
              </Button>
              <Button
                color="primary"
                onPress={onPublish}
                isLoading={publishing}
              >
                {publishing ? publishingLabel : publishLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export function CommunicationPanel({ tenantId, announcements: initial }: Props) {
  const { t } = useTranslation('admin')

  const [channel, setChannel] = useState<AnnouncementChannel>('participants')
  const [draft, setDraft] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [pendingChannel, setPendingChannel] = useState<AnnouncementChannel | null>(null)
  const [localAnnouncements, setLocalAnnouncements] = useState<Announcement[]>(initial)

  const isDirty = draft.trim().length > 0

  const handleChannelClick = useCallback(
    (next: AnnouncementChannel) => {
      if (next === channel) return
      if (isDirty) {
        setPendingChannel(next)
      } else {
        setChannel(next)
      }
    },
    [channel, isDirty]
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
        const newEntry: Announcement = {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          channel: targetChannel,
          body,
          sms_sent: false,
          published_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }
        setLocalAnnouncements((prev) => [newEntry, ...prev])
        return true
      } finally {
        setPublishing(false)
      }
    },
    [tenantId, t]
  )

  const handlePublish = useCallback(async () => {
    if (!isDirty || publishing) return
    const ok = await publish(channel, draft.trim())
    if (ok) setDraft('')
  }, [channel, draft, isDirty, publish, publishing])

  const handleGuardCancel = useCallback(() => setPendingChannel(null), [])

  const handleGuardDiscard = useCallback(() => {
    const next = pendingChannel!
    setPendingChannel(null)
    setDraft('')
    setChannel(next)
  }, [pendingChannel])

  const handleGuardPublish = useCallback(async () => {
    const next = pendingChannel!
    const ok = await publish(channel, draft.trim())
    if (ok) {
      setPendingChannel(null)
      setDraft('')
      setChannel(next)
    }
  }, [channel, draft, pendingChannel, publish])

  const filtered = localAnnouncements.filter((a) => a.channel === channel)

  const timelineLabel =
    channel === 'participants'
      ? t('communication.timelineParticipants')
      : t('communication.timelineOfficials')

  return (
    <>
      <div className="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{t('communication.title')}</h1>
        </div>

        {/* Channel toggle */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm font-medium text-default-500">{t('communication.channel')}</span>
          <div className="flex gap-1">
            {(['participants', 'officials'] as AnnouncementChannel[]).map((ch) => (
              <Button
                key={ch}
                type="button"
                onPress={() => handleChannelClick(ch)}
                color={channel === ch ? 'primary' : 'default'}
                variant={channel === ch ? 'solid' : 'bordered'}
                size="sm"
                radius="full"
              >
                {t(`communication.${ch}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* New announcement card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {t('communication.newAnnouncement')}
          </p>
          <Textarea
            value={draft}
            onValueChange={setDraft}
            placeholder={t('communication.announcementPlaceholder')}
            minRows={4}
            classNames={{ inputWrapper: 'shadow-none' }}
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-default-400">{t('communication.smsNote')}</span>
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
        </div>

        {/* Timeline */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {timelineLabel}
          </p>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 rounded-lg border-2 border-gray-200 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-gray-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-default-500">{t('communication.noAnnouncementsYet')}</p>
                <p className="text-xs text-default-400 mt-0.5">{t('communication.noAnnouncementsHint')}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {filtered.map((a) => (
                <div key={a.id} className="px-5 py-4">
                  <p className="text-sm text-gray-900 leading-snug">{a.body}</p>
                  <p className="text-xs text-default-400 mt-1">{formatDate(a.published_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unsaved-changes guard */}
      <AnnouncementGuardDialog
        open={pendingChannel !== null}
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
