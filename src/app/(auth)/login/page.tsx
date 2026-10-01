'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { LanguageSwitcher } from '@/components/language-switcher'
import { type Locale } from '@/lib/i18n/config'
import { useLanguage } from '@/components/i18n-provider'
import { SelectItem } from '@heroui/react'
import { Input, Select } from '@/components/ui/form-fields'
import { SignInButton } from './_components/sign-in-button'
import { LinkAction } from './_components/link-action'
import { toastError, parseRetryAfterMinutes } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { authErrorKey } from '@/lib/auth/auth-error-keys'
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
  // Nowhere to persist this yet — there is no session until the OTP
  // verifies. It rides along on the verify call, which is the first point
  // where a user id exists to attach it to.
  //
  // `chosen` tracks whether the user actually touched the switcher. Sending
  // `language` unconditionally would post the page default on every sign-in
  // and overwrite a returning user's stored choice with it — someone who had
  // picked Swedish would be reset to English each time they signed in.
  // Seeded from the language this render is already in, not from
  // defaultLocale. The strings on this page come from the i18next instance the
  // root layout seeded with the signed-in user's stored language, so hardcoding
  // the default made the switcher disagree with the text beside it: a Swedish
  // user signing out got a page the server rendered in Swedish and the client
  // hydrated as English. Reading the same value both sides keeps them equal.
  const renderLanguage = useLanguage()
  const [language, setLanguage] = useState<Locale>(renderLanguage)
  const [languageChosen, setLanguageChosen] = useState(false)

  function handleLanguageChange(next: Locale) {
    setLanguage(next)
    setLanguageChosen(true)
  }

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
          // Omitted entirely when untouched, so the stored preference stands.
          ...(languageChosen ? { language } : {}),
        })
      )
    ) {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-sm px-6 pb-16">
      {/* The one screen with no stored preference to read: a user who has not
          signed in yet gets the default locale whatever they chose last time,
          so without this a Swedish user meets an English sign-in page and no
          way to change it. The choice rides along on the verify call and is
          saved once there is a user id to attach it to. */}
      <div className="mb-6 flex justify-end">
        <LanguageSwitcher current={language} persist={false} onChange={handleLanguageChange} />
      </div>
      <h1 className="page-title mb-8">{t('signIn.title')}</h1>

      {step === 'phone' ? (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
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
    </main>
  )
}
