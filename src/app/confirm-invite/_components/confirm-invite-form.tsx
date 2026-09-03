'use client'

import { useState } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { confirmInviteByPhone } from '@/lib/actions/confirm-invite-by-phone'

export default function ConfirmInviteForm() {
  const { t } = useTranslation('auth')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    if (!privacyAccepted) return
    setLoading(true)
    const result = await confirmInviteByPhone(privacyAccepted)
    setLoading(false)
    if (result?.error) {
      toastError(t('confirmInvite.error'))
    }
  }

  return (
    <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
      <div className="flex-1 overflow-y-auto pt-12">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmInvite.title')}</h1>
        <hr className="border-dashed border-gray-200 mb-8" />
        <p className="text-sm text-gray-500 mb-6">{t('confirmInvite.intro')}</p>

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
          disabled={!privacyAccepted || loading}
          className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? t('confirmInvite.confirming') : t('confirmInvite.confirmButton')}
        </button>
      </div>
    </main>
  )
}
