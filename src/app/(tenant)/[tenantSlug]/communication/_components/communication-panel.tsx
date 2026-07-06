'use client'

import { createPortal } from 'react-dom'
import { useState, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n/client'
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
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="px-6 pt-6 pb-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">{title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={publishing}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={publishing}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            {discardLabel}
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={publishing}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {publishing ? publishingLabel : publishLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
        if (!res.ok) return false
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
    [tenantId]
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
          <span className="text-sm font-medium text-gray-500">{t('communication.channel')}</span>
          <div className="flex gap-1">
            {(['participants', 'officials'] as AnnouncementChannel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => handleChannelClick(ch)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  channel === ch
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
                }`}
              >
                {t(`communication.${ch}`)}
              </button>
            ))}
          </div>
        </div>

        {/* New announcement card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {t('communication.newAnnouncement')}
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('communication.announcementPlaceholder')}
            rows={4}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-400">{t('communication.smsNote')}</span>
            <button
              type="button"
              onClick={handlePublish}
              disabled={!isDirty || publishing}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {publishing ? t('communication.publishing') : t('communication.publish')}
            </button>
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
                <p className="text-sm font-medium text-gray-500">{t('communication.noAnnouncementsYet')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('communication.noAnnouncementsHint')}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
              {filtered.map((a) => (
                <div key={a.id} className="px-5 py-4">
                  <p className="text-sm text-gray-900 leading-snug">{a.body}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDate(a.published_at)}</p>
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
