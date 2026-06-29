'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const { t } = useTranslation('auth')

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendOtp() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setStep('otp')
    }
  }

  async function verifyOtp() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push('/')
    }
  }

  return (
    <main className="max-w-sm mx-auto mt-20 p-6">
      <h1 className="text-2xl font-semibold mb-6">{t('signIn.title')}</h1>

      {step === 'phone' ? (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm text-gray-600">{t('signIn.phoneLabel')}</span>
            <input
              type="tel"
              placeholder={t('signIn.phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full border rounded px-3 py-2"
            />
          </label>
          <button
            onClick={sendOtp}
            disabled={loading || !phone}
            className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
          >
            {loading ? t('signIn.requestingCode') : t('signIn.requestCodeButton')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('signIn.codeSentTo', { phone })}</p>
          <label className="block">
            <span className="text-sm text-gray-600">{t('signIn.codeLabel')}</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              className="mt-1 block w-full border rounded px-3 py-2"
            />
          </label>
          <button
            onClick={verifyOtp}
            disabled={loading || otp.length !== 6}
            className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
          >
            {loading ? t('signIn.verifying') : t('signIn.verifyButton')}
          </button>
          <button onClick={() => setStep('phone')} className="text-sm text-gray-600 underline">
            {t('signIn.changeNumber')}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </main>
  )
}
