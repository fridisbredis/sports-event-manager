'use client'

import { useState } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { confirmInviteByPhone } from '@/lib/actions/confirm-invite-by-phone'
import type { PendingOfficialInvite } from '@/lib/auth/tenant'

interface ConfirmInviteFormProps {
  invites: PendingOfficialInvite[]
}

export default function ConfirmInviteForm({ invites }: ConfirmInviteFormProps) {
  const { t } = useTranslation('auth')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const selectable = invites.filter((invite) => !invite.expired)
  // Auto-selected only when exactly one invite is actually selectable — an
  // expired invite can never be confirmed, so auto-selecting it would enable
  // the confirm button on a request that's guaranteed to fail server-side.
  const [selectedTenantId, setSelectedTenantId] = useState(
    selectable.length === 1 ? selectable[0].tenantId : ''
  )

  const showPicker = invites.length > 1
  const allExpired = selectable.length === 0

  async function handleConfirm() {
    if (!privacyAccepted || !selectedTenantId) return
    setLoading(true)
    const result = await confirmInviteByPhone(selectedTenantId, privacyAccepted)
    setLoading(false)
    if (result?.error) {
      toastError(t('confirmInvite.error'))
    }
  }

  if (allExpired) {
    return (
      <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
        <div className="flex-1 overflow-y-auto pt-12">
          <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmInvite.title')}</h1>
          <hr className="border-dashed border-gray-200 mb-8" />
          <p className="text-sm font-medium text-gray-900 mb-2">
            {t('confirmInvite.expiredStateTitle')}
          </p>
          <p className="text-sm text-gray-500">{t('confirmInvite.expiredStateMessage')}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
      <div className="flex-1 overflow-y-auto pt-12">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmInvite.title')}</h1>
        <hr className="border-dashed border-gray-200 mb-8" />
        <p className="text-sm text-gray-500 mb-6">{t('confirmInvite.intro')}</p>

        {showPicker && (
          <div className="mb-6">
            <p className="text-sm text-gray-700 mb-3">
              {t('confirmInvite.chooseOrganizationPrompt')}
            </p>
            <div role="radiogroup" className="flex flex-col gap-2">
              {invites.map((invite) => {
                const selected = selectedTenantId === invite.tenantId
                const disabled = invite.expired
                return (
                  <button
                    key={invite.tenantId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={disabled}
                    disabled={disabled}
                    aria-label={t('confirmInvite.organizationOptionLabel', {
                      name: invite.tenantName,
                    })}
                    onClick={() => !disabled && setSelectedTenantId(invite.tenantId)}
                    className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-left transition-colors ${
                      disabled
                        ? 'border-gray-200 bg-white opacity-50 cursor-not-allowed'
                        : selected
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        selected ? 'border-gray-900' : 'border-gray-300'
                      }`}
                    >
                      {selected && <div className="h-2 w-2 rounded-full bg-gray-900" />}
                    </div>
                    <span className="flex flex-col">
                      <span className="text-gray-900 font-medium">{invite.tenantName}</span>
                      <span className="text-xs text-gray-400">{invite.tenantSlug}</span>
                      {disabled && (
                        <span className="text-xs text-red-500">
                          {t('confirmInvite.expiredLabel')}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setPrivacyAccepted((v) => !v)}
          className={`w-full flex items-start gap-3 rounded-xl border px-4 py-3 text-sm text-left transition-colors ${
            privacyAccepted
              ? 'border-gray-900 bg-gray-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <div
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              privacyAccepted ? 'border-gray-900 bg-gray-900' : 'border-gray-300'
            }`}
          >
            {privacyAccepted && (
              <svg
                className="h-2.5 w-2.5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <span className="text-gray-700">
            {t('confirmation.privacyCheckPrefix')}{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-gray-900"
            >
              {t('confirmation.privacyCheckLinkText')}
            </a>
          </span>
        </button>
      </div>

      <div className="pb-8 pt-6 shrink-0">
        <button
          onClick={handleConfirm}
          disabled={!privacyAccepted || !selectedTenantId || loading}
          className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? t('confirmInvite.confirming') : t('confirmInvite.confirmButton')}
        </button>
      </div>
    </main>
  )
}
