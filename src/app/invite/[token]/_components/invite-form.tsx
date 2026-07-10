'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'

type Step = 'fill-form' | 'verify-otp' | 'confirming' | 'success' | 'invalid'

interface Props {
  token: string
  phone: string | null
  name: string | null
}

export default function InviteForm({ token, phone: initialPhone, name: initialName }: Props) {
  const { t } = useTranslation('auth')
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [step, setStep] = useState<Step>(initialPhone ? 'fill-form' : 'invalid')
  const [name, setName] = useState(initialName ?? '')
  const [available, setAvailable] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConfirmAvailability() {
    if (!available || !initialPhone) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: initialPhone })
    setLoading(false)
    if (error) {
      toastError(error.message)
    } else {
      setStep('verify-otp')
    }
  }

  async function handleVerifyOtp() {
    if (!initialPhone) return
    setLoading(true)
    const { data, error } = await supabase.auth.verifyOtp({
      phone: initialPhone,
      token: otp,
      type: 'sms',
    })
    if (error) {
      setLoading(false)
      toastError(t('confirmation.invalidCode'))
      return
    }

    const accessToken = data.session?.access_token

    // OTP verified — confirm the invite server-side.
    // Pass the access token explicitly so the route handler can authenticate
    // without relying on cookie propagation timing in Next.js.
    const res = await fetch('/api/officials/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ token, name: name.trim() }),
    })
    setLoading(false)
    if (res.ok) {
      setStep('success')
    } else {
      setStep('invalid')
    }
  }

  if (step === 'invalid') {
    return (
      <main className="flex flex-col min-h-screen max-w-sm mx-auto px-6">
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-gray-300">
            <span className="text-2xl text-gray-400">!</span>
          </div>
          <p className="text-base font-semibold text-gray-900">{t('confirmation.invalidTitle')}</p>
        </div>
        <div className="pb-8">
          <button
            onClick={() => router.push('/login')}
            className="w-full rounded-xl bg-gray-100 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {t('confirmation.requestNewLink')}
          </button>
        </div>
      </main>
    )
  }

  if (step === 'success') {
    return (
      <main className="flex flex-col min-h-screen max-w-sm mx-auto px-6">
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-gray-700">
            <svg className="h-8 w-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-semibold text-gray-900">{t('confirmation.successTitle')}</p>
        </div>
        <div className="pb-8">
          <button
            onClick={() => router.push('/')}
            className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
          >
            {t('confirmation.goHome')}
          </button>
        </div>
      </main>
    )
  }

  if (step === 'verify-otp') {
    return (
      <main className="flex flex-col min-h-screen max-w-sm mx-auto px-6">
        <div className="flex-1 pt-12">
          <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmation.title')}</h1>
          <hr className="border-dashed border-gray-200 mb-8" />
          <p className="text-sm text-gray-500 mb-6">{t('signIn.codeSentTo', { phone: initialPhone })}</p>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">{t('signIn.codeLabel')}</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && otp.length === 6 && handleVerifyOtp()}
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 tracking-widest placeholder:text-gray-300 focus:border-gray-400 focus:outline-none"
              placeholder="000000"
            />
          </div>
        </div>
        <div className="pb-8">
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {loading ? t('signIn.verifying') : t('signIn.verifyButton')}
          </button>
        </div>
      </main>
    )
  }

  // fill-form state
  return (
    <main className="flex flex-col min-h-screen max-w-sm mx-auto px-6">
      <div className="flex-1 pt-12">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmation.title')}</h1>
        <hr className="border-dashed border-gray-200 mb-8" />

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              {t('confirmation.phoneLabel')}
            </label>
            <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="flex-1 text-sm text-gray-700">{initialPhone}</span>
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              {t('confirmation.availabilityLabel')}
            </label>
            <button
              type="button"
              onClick={() => setAvailable((v) => !v)}
              className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-sm text-left transition-colors ${
                available
                  ? 'border-gray-900 bg-gray-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                available ? 'border-gray-900 bg-gray-900' : 'border-gray-300'
              }`}>
                {available && (
                  <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-gray-700">{t('confirmation.availabilityCheck')}</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              {t('confirmation.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('confirmation.namePlaceholder')}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
          </div>

          <p className="flex gap-2 text-xs text-gray-400 leading-relaxed">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
            </svg>
            {t('confirmation.notificationsInfo')}
          </p>
        </div>
      </div>

      <div className="pb-8 pt-6">
        <button
          onClick={handleConfirmAvailability}
          disabled={!available || !name.trim() || loading}
          className="w-full rounded-xl bg-gray-900 py-4 text-sm font-semibold text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          {loading ? t('confirmation.confirming') : t('confirmation.confirmButton')}
        </button>
      </div>
    </main>
  )
}
