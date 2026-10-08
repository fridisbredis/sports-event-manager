'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { SelectItem } from '@heroui/react'
import { Input, Select } from '@/components/ui/form-fields'
import { SignInButton } from './_components/sign-in-button'
import { LinkAction } from './_components/link-action'
import { toastError, parseRetryAfterMinutes } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { authErrorKey, isExpectedAuthError } from '@/lib/auth/auth-error-keys'
import {
  normalizePhoneToE164,
  isValidPhoneForCountry,
  guessPhoneCountryFromLocale,
  PHONE_COUNTRIES,
} from '@/lib/phone'

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
  // Only show the "invalid number" message once the user has finished with
  // the field — on blur, or on a submit attempt. Validating on every keystroke
  // means a half-typed number ("6") renders as an error, which reads as the
  // form scolding someone who is simply still typing. The submit button is
  // already gated on `phoneIsValid`, so nothing is lost by staying quiet.
  const [phoneTouched, setPhoneTouched] = useState(false)
  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)
  const showPhoneError = phoneTouched && phone.trim() !== '' && !phoneIsValid

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
      //
      // warn, not error, when the code is one authErrorKey already has a
      // message for (below): those are the form's normal failure paths, and
      // logger.error reports to Sentry (REL-02). Mirrors the same split in
      // api/auth/{send,verify}-otp.
      const details = { code: error.code, message: error.message }
      if (isExpectedAuthError(error.code)) {
        logger.warn('[auth] sign-in request failed', details)
      } else {
        logger.error('[auth] sign-in request failed', undefined, details)
      }
      if (error.retryAfterMinutes !== undefined) {
        toastError(
          t('signIn.tooManyRequests', {
            count: error.retryAfterMinutes,
            minutes: error.retryAfterMinutes,
          })
        )
      } else {
        toastError(t(authErrorKey(error.code)))
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
      const details = { code: error.code, message: error.message }
      if (isExpectedAuthError(error.code)) {
        logger.warn('[auth] resend OTP failed', details)
      } else {
        logger.error('[auth] resend OTP failed', undefined, details)
      }
      if (error.retryAfterMinutes !== undefined) {
        toastError(
          t('signIn.tooManyRequests', {
            count: error.retryAfterMinutes,
            minutes: error.retryAfterMinutes,
          })
        )
      } else {
        toastError(t(authErrorKey(error.code)))
      }
      return
    }
    setOtp('')
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
  }

  async function verifyOtp() {
    if (
      await request(() =>
        postJson('/api/auth/verify-otp', {
          phone: normalizedPhone,
          token: otp,
        })
      )
    ) {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-sm px-6 pb-16">
      <h1 className="page-title mb-8">{t('signIn.title')}</h1>

      {step === 'phone' ? (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            setPhoneTouched(true)
            if (!loading && phoneIsValid) sendOtp()
          }}
        >
          {/* The country picker is deliberately the narrower of the two: it
              holds a fixed four-option code, while the number itself is what
              the user types and needs the room. Its label truncates to
              "SE (+..." at this width, which the design accepts. */}
          <div className="flex items-start gap-3">
            <Select
              label={t('signIn.phoneCountry')}
              className="w-[42%] shrink-0"
              selectedKeys={[phoneCountry]}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0] as string
                setPhoneCountry(next as typeof phoneCountry)
                setPhoneTouched(false)
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
              onValueChange={(value) => {
                setPhone(value)
                // Clear the error the moment typing resumes, rather than
                // leaving it up while the user corrects the number.
                setPhoneTouched(false)
              }}
              onBlur={() => setPhoneTouched(true)}
              isInvalid={showPhoneError}
              errorMessage={showPhoneError ? t('signIn.invalidPhone') : undefined}
            />
          </div>
          <SignInButton
            type="submit"
            className="w-full"
            isLoading={loading}
            isDisabled={loading || !phoneIsValid}
          >
            {loading ? t('signIn.requestingCode') : t('signIn.requestCodeButton')}
          </SignInButton>
        </form>
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (!loading && otp.length === 6) verifyOtp()
          }}
        >
          <p className="text-base text-ink-soft">
            {t('signIn.codeSentTo', { phone: normalizedPhone })}
          </p>
          {/* Placeholder rather than a floating label: the paragraph above
              already says what this field is for, so a label would repeat it. */}
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            aria-label={t('signIn.codeLabel')}
            placeholder={t('signIn.codeLabel')}
            value={otp}
            onValueChange={setOtp}
          />
          <SignInButton
            type="submit"
            className="w-full"
            isLoading={loading}
            isDisabled={loading || otp.length !== 6}
          >
            {loading ? t('signIn.verifying') : t('signIn.verifyButton')}
          </SignInButton>
          {/* The two secondary actions are text links in the design, and are
              spaced apart from the button and from each other so the pill
              stays the only thing reading as pressable. */}
          <div className="space-y-4 pt-2">
            <LinkAction onPress={resendOtp} isDisabled={resending || resendCooldown > 0}>
              {resendCooldown > 0
                ? t('signIn.resendCodeCooldown', { seconds: resendCooldown })
                : t('signIn.resendCodeButton')}
            </LinkAction>
            <LinkAction onPress={() => setStep('phone')}>{t('signIn.changeNumber')}</LinkAction>
          </div>
        </form>
      )}

      {/* Shown in both steps: GDPR asks that people can read how their phone
          number is handled before they hand it over, not only after. Opens in
          a new tab so a half-finished sign-in isn't thrown away. */}
      <p className="mt-10 text-center">
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md text-sm text-ink-soft underline transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {t('signIn.privacyLink')}
        </a>
      </p>
    </main>
  )
}
