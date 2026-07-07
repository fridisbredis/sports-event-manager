'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '@/lib/i18n/client'
import ConfirmDialog from '@/components/confirm-dialog'
import type { Official } from '@/types/app'

interface Props {
  tenantSlug: string
  tenantId: string
  officials: Official[]
  currentUserId: string
}

export default function OfficialsList({ tenantId, officials: initialOfficials, currentUserId }: Props) {
  const { t } = useTranslation('admin')
  const [officials, setOfficials] = useState<Official[]>(initialOfficials)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Official | null>(null)
  const [pending, setPending] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  async function handleAdd() {
    if (!name.trim() || !phone.trim() || pending) return
    setPending(true)
    try {
      const res = await fetch('/api/officials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name: name.trim(), phone: phone.trim() }),
      })
      if (res.ok) {
        const { official } = await res.json()
        setOfficials((prev) => [...prev, official])
        setName('')
        setPhone('')
        setAddModalOpen(false)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    setPending(true)
    try {
      const res = await fetch(`/api/officials/${removeTarget.id}?tenantId=${tenantId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setOfficials((prev) => prev.filter((o) => o.id !== removeTarget.id))
        setRemoveTarget(null)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleResend(official: Official) {
    setResendingId(official.id)
    try {
      await fetch(`/api/officials/${official.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
    } finally {
      setResendingId(null)
    }
  }

  const visibleOfficials = officials.filter((o) => o.invite_status !== 'removed')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('officials.title')}</h1>
        <button
          onClick={() => setAddModalOpen(true)}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          {t('officials.add')}
        </button>
      </div>

      {visibleOfficials.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
          <svg
            className="mb-4 h-12 w-12 text-gray-300"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="8" y="8" width="32" height="32" rx="2" />
            <line x1="8" y1="8" x2="40" y2="40" />
            <line x1="40" y1="8" x2="8" y2="40" />
          </svg>
          <p className="text-base font-medium text-gray-900 mb-1">{t('officials.empty')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('officials.emptyHint')}</p>
          <button
            onClick={() => setAddModalOpen(true)}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            {t('officials.add')}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('officials.name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('officials.phone')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('officials.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('officials.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleOfficials.map((official) => {
                const isCurrentUser = official.user_id === currentUserId
                const isResending = resendingId === official.id

                return (
                  <tr key={official.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {isCurrentUser ? `${official.name} — ${t('officials.youLabel')}` : official.name}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{official.phone}</td>
                    <td className="px-4 py-3">
                      {official.invite_status === 'confirmed' ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                          {t('officials.confirmed')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                          {t('officials.invited')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!isCurrentUser && (
                        <div className="flex items-center gap-2">
                          {official.invite_status === 'invited' && (
                            <button
                              onClick={() => handleResend(official)}
                              disabled={isResending}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors disabled:opacity-50"
                            >
                              {isResending ? t('officials.sending') : t('officials.resendInvite')}
                            </button>
                          )}
                          <button
                            onClick={() => setRemoveTarget(official)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
                          >
                            {t('officials.remove')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add official modal */}
      {addModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
              <div className="px-6 pt-6 pb-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-5">{t('officials.addTitle')}</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('officials.name')}</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('officials.namePlaceholder')}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('officials.phone')}</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+46 70 000 00 00"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <p className="mt-1.5 text-xs text-gray-400">{t('officials.phoneHint')}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => { setAddModalOpen(false); setName(''); setPhone('') }}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
                >
                  {t('officials.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!name.trim() || !phone.trim() || pending}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {pending ? t('officials.sending') : t('officials.sendInvite')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Remove confirmation */}
      <ConfirmDialog
        open={removeTarget !== null}
        title={t('officials.removeConfirmTitle')}
        body={t('officials.removeConfirmBody', { name: removeTarget?.name ?? '' })}
        cancelLabel={t('officials.cancel')}
        confirmLabel={t('officials.remove')}
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </div>
  )
}
