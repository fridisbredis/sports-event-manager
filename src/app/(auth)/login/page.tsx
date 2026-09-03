'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { SelectItem } from '@heroui/react'
import { Input, Select } from '@/components/ui/form-fields'
import { Button } from '@/components/ui/button'
import { toastError, parseRetryAfterMinutes } from '@/lib/toast'
import { logger } from '@/lib/logger'
import {
  normalizePhoneToE164,
  isValidPhoneForCountry,
  guessPhoneCountryFromLocale,
  PHONE_COUNTRIES,
} from '@/lib/phone'

// GoTrue error codes → translation keys. `otp_expired` covers both a mistyped
// and an expired code — GoTrue does not distinguish them, so the message must
// work for both cases.
const AUTH_ERROR_KEYS: Record<string, string> = {
  otp_expired: 'signIn.invalidCode',
  over_sms_send_rate_limit: 'signIn.tooManyRequests',
  over_request_rate_limit: 'signIn.tooManyRequests',
  signup_disabled: 'signIn.notRegistered',
}

const RESEND_COOLDOWN_SECONDS = 30

// GoTrue error codes are surfaced the same way whether the error originates
// from Supabase directly or from our own rate-limit rejection (over_request_rate_limit),
// so the client's error handling doesn't need to distinguish the source.
async function postJson(
  url: string,
  body: unknown
): Promise<{
  error: { message: string; code?: string; retryAfterMinutes?: number } | null
}> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { error: null }
  const data = await res.json().catch(() => ({}))
  const retryAfterMinutes = res.status === 429 ? parseRetryAfterMinutes(res) : undefined
  return { error: { message: data.error ?? 'Request failed', code: data.code, retryAfterMinutes } }
}

export default function LoginPage() {
  const router = useRouter()
  const { t } = useTranslation('auth')

  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(() =>
    guessPhoneCountryFromLocale(typeof navigator === 'undefined' ? undefined : navigator.language)
  )
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [normalizedPhone, setNormalizedPhone] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)

  useEffect(() => {
    if (resendCooldown === 0) return
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  async function request(
    fn: () => Promise<{
      error: { message: string; code?: string; retryAfterMinutes?: number } | null
    }>
  ) {
    setLoading(true)
    const { error } = await fn()
    setLoading(false)
    if (error) {
      // Keep the provider's own text for debugging, but never show it to the
      // user — it is untranslated and worded for developers.
      logger.error('[auth] sign-in request failed', undefined, {
        code: error.code,
        message: error.message,
      })
      if (error.retryAfterMinutes !== undefined) {
        toastError(
          t('signIn.tooManyRequests', {
            count: error.retryAfterMinutes,
            minutes: error.retryAfterMinutes,
          })
        )
      } else {
        toastError(t(AUTH_ERROR_KEYS[error.code ?? ''] ?? 'signIn.error'))
      }
    }
    return !error
  }

  async function sendOtp() {
    const e164Phone = normalizePhoneToE164(phone, phoneCountry)
    if (!e164Phone) return
    if (await request(() => postJson('/api/auth/send-otp', { phone: e164Phone }))) {
      setNormalizedPhone(e164Phone)
      setStep('otp')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    }
  }

  async function resendOtp() {
    if (resendCooldown > 0 || resending) return
    setResending(true)
    const { error } = await postJson('/api/auth/send-otp', { phone: normalizedPhone })
    setResending(false)
    if (error) {
      logger.error('[auth] resend OTP failed', undefined, {
        code: error.code,
        message: error.message,
      })
      if (error.retryAfterMinutes !== undefined) {
        toastError(
          t('signIn.tooManyRequests', {
            count: error.retryAfterMinutes,
            minutes: error.retryAfterMinutes,
          })
        )
      } else {
        toastError(t(AUTH_ERROR_KEYS[error.code ?? ''] ?? 'signIn.error'))
      }
      return
    }
    setOtp('')
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
  }

  async function verifyOtp() {
    if (
      await request(() => postJson('/api/auth/verify-otp', { phone: normalizedPhone, token: otp }))
    ) {
      router.push('/')
      router.refresh()
    }
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
            onPress={resendOtp}
            isLoading={resending}
            isDisabled={resending || resendCooldown > 0}
            className="w-full text-sm"
          >
            {resendCooldown > 0
              ? t('signIn.resendCodeCooldown', { seconds: resendCooldown })
              : t('signIn.resendCodeButton')}
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
