'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/client'
import { Button, Input } from '@heroui/react'
import { toastError } from '@/lib/toast'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const { t } = useTranslation('auth')

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  async function request(fn: () => Promise<{ error: { message: string } | null }>) {
    setLoading(true)
    const { error } = await fn()
    setLoading(false)
    if (error) {
      toastError(error.message)
    }
    return !error
  }

  async function sendOtp() {
    if (await request(() => supabase.auth.signInWithOtp({ phone }))) setStep('otp')
  }

  async function verifyOtp() {
    if (await request(() => supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' }))) router.push('/')
  }

  return (
    <main className="max-w-sm mx-auto mt-20 p-6">
      <h1 className="text-2xl font-semibold mb-6">{t('signIn.title')}</h1>

      {step === 'phone' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loading && phone) sendOtp()
          }}
        >
          <Input
            type="tel"
            label={t('signIn.phoneLabel')}
            placeholder={t('signIn.phonePlaceholder')}
            value={phone}
            onValueChange={setPhone}
          />
          <Button
            type="submit"
            color="primary"
            className="w-full"
            isLoading={loading}
            isDisabled={loading || !phone}
          >
            {loading ? t('signIn.requestingCode') : t('signIn.requestCodeButton')}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loading && otp.length === 6) verifyOtp()
          }}
        >
          <p className="text-sm text-default-500">{t('signIn.codeSentTo', { phone })}</p>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            label={t('signIn.codeLabel')}
            value={otp}
            onValueChange={setOtp}
          />
          <Button
            type="submit"
            color="primary"
            className="w-full"
            isLoading={loading}
            isDisabled={loading || otp.length !== 6}
          >
            {loading ? t('signIn.verifying') : t('signIn.verifyButton')}
          </Button>
          <Button type="button" variant="light" onPress={() => setStep('phone')} className="text-sm">
            {t('signIn.changeNumber')}
          </Button>
        </form>
      )}
    </main>
  )
}
