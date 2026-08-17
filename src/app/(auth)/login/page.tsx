'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/client'
import { Button, Input, Select, SelectItem } from '@heroui/react'
import { toastError } from '@/lib/toast'
import {
  normalizePhoneToE164,
  isValidPhoneForCountry,
  guessPhoneCountryFromLocale,
  PHONE_COUNTRIES,
} from '@/lib/phone'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const { t } = useTranslation('auth')

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(() =>
    guessPhoneCountryFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language)
  )
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [normalizedPhone, setNormalizedPhone] = useState('')

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)

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
    const e164Phone = normalizePhoneToE164(phone, phoneCountry)
    if (!e164Phone) return
    if (await request(() => supabase.auth.signInWithOtp({ phone: e164Phone }))) {
      setNormalizedPhone(e164Phone)
      setStep('otp')
    }
  }

  async function verifyOtp() {
    if (
      await request(() =>
        supabase.auth.verifyOtp({ phone: normalizedPhone, token: otp, type: 'sms' })
      )
    )
      router.push('/')
  }

  return (
    <main className="max-w-sm mx-auto mt-20 p-6">
      <h1 className="text-2xl font-semibold mb-6">{t('signIn.title')}</h1>

      {step === 'phone' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loading && phoneIsValid) sendOtp()
          }}
        >
          <div className="flex gap-2">
            <Select
              label={t('signIn.phoneCountry')}
              className="w-56"
              selectedKeys={[phoneCountry]}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0] as string
                setPhoneCountry(next as typeof phoneCountry)
              }}
            >
              {PHONE_COUNTRIES.map((c) => (
                <SelectItem key={c.code} textValue={c.label}>
                  {c.label}
                </SelectItem>
              ))}
            </Select>
            <Input
              type="tel"
              label={t('signIn.phoneLabel')}
              placeholder={t('signIn.phonePlaceholder')}
              value={phone}
              onValueChange={setPhone}
              isInvalid={phone.trim() !== '' && !phoneIsValid}
              errorMessage={
                phone.trim() !== '' && !phoneIsValid ? t('signIn.invalidPhone') : undefined
              }
            />
          </div>
          <Button
            type="submit"
            color="primary"
            className="w-full"
            isLoading={loading}
            isDisabled={loading || !phoneIsValid}
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
          <p className="text-sm text-default-500">
            {t('signIn.codeSentTo', { phone: normalizedPhone })}
          </p>
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
          <Button
            type="button"
            variant="light"
            onPress={() => setStep('phone')}
            className="w-full text-sm"
          >
            {t('signIn.changeNumber')}
          </Button>
        </form>
      )}
    </main>
  )
}
