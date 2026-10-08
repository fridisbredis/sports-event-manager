'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/client'
import { defaultLocale, locales, type Locale } from '@/lib/i18n/config'
import { toastError } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { authErrorKey, isExpectedAuthError } from '@/lib/auth/auth-error-keys'

const RESEND_COOLDOWN_SECONDS = 30

// Written in their own language, never translated: someone who has landed in
// a language they cannot read must still be able to find their own. Same rule
// as LanguageSwitcher, which this select replaces throughout this flow.
const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  sv: 'Svenska',
}

type Step = 'fill-form' | 'verify-otp' | 'confirming' | 'success' | 'invalid'

interface Props {
  token: string
  phone: string | null
  name: string | null
}

export default function InviteForm({ token, phone: initialPhone, name: initialName }: Props) {
  // i18n, not just t: changing the language is what this component does when
  // the select changes, and only i18n.changeLanguage re-renders the strings.
  // It is the instance from the surrounding provider, never the imported
  // singleton — on the server that one is shared across every request.
  const { t, i18n } = useTranslation('auth')
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [step, setStep] = useState<Step>(initialPhone ? 'fill-form' : 'invalid')
  const [name, setName] = useState(initialName ?? '')
  const [available, setAvailable] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  // Not persisted while the invitee is still signed out — there is no user
  // row to write to yet. It rides along on the confirm call below, which is
  // the first moment an auth.users row is guaranteed to exist.
  const [language, setLanguage] = useState<Locale>(defaultLocale)
  // Whether the invitee actually picked a language, as opposed to just taking
  // the page default. Only a real choice is stored, so an absent
  // user_preferences row keeps meaning "never chose" rather than "was shown
  // English once" — same rule as the sign-in page.
  const [languageChosen, setLanguageChosen] = useState(false)

  function handleLanguageChange(next: Locale) {
    if (next === language) return
    setLanguage(next)
    setLanguageChosen(true)
    // Repaints the form in the chosen language right away. Nothing is persisted
    // here — the invitee is still signed out, so the choice rides along on the
    // confirm call instead.
    i18n.changeLanguage(next)
  }

  useEffect(() => {
    if (resendCooldown <= 0) return
    const interval = setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [resendCooldown])

  async function handleConfirmAvailability() {
    if (!available || !privacyAccepted || !initialPhone) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: initialPhone })
    setLoading(false)
    if (error) {
      // Keep the provider's own text for debugging, but never show it to the
      // user — it is untranslated and worded for developers. Same handling as
      // the sign-in page, which calls the same signInWithOtp and so can return
      // exactly the same codes.
      const details = { code: error.code, message: error.message }
      if (isExpectedAuthError(error.code)) {
        logger.warn('[auth] invite OTP request failed', details)
      } else {
        logger.error('[auth] invite OTP request failed', undefined, details)
      }
      toastError(t(authErrorKey(error.code)))
    } else {
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setStep('verify-otp')
    }
  }

  async function handleResendOtp() {
    if (!initialPhone || resendCooldown > 0 || resending) return
    setResending(true)
    const { error } = await supabase.auth.signInWithOtp({ phone: initialPhone })
    setResending(false)
    if (error) {
      const details = { code: error.code, message: error.message }
      if (isExpectedAuthError(error.code)) {
        logger.warn('[auth] invite OTP resend failed', details)
      } else {
        logger.error('[auth] invite OTP resend failed', undefined, details)
      }
      toastError(t(authErrorKey(error.code)))
      return
    }
    setOtp('')
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
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
      body: JSON.stringify({
        token,
        name: name.trim(),
        privacyAccepted,
        ...(languageChosen ? { language } : {}),
      }),
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
      <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center text-center py-16">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-gray-300">
            <span className="text-2xl text-gray-400">!</span>
          </div>
          <p className="text-base font-semibold text-gray-900">{t('confirmation.invalidTitle')}</p>
        </div>
        <div className="pb-8 shrink-0">
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
      <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center text-center py-16">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-tenant-primary">
            <svg
              className="h-8 w-8 text-tenant-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-semibold text-gray-900">{t('confirmation.successTitle')}</p>
        </div>
        <div className="pb-8 shrink-0">
          <button
            onClick={() => router.push('/')}
            className="w-full rounded-xl bg-tenant-primary py-4 text-sm font-semibold text-white transition-colors hover:bg-tenant-primary-hover"
          >
            {t('confirmation.goHome')}
          </button>
        </div>
      </main>
    )
  }

  if (step === 'verify-otp') {
    return (
      <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
        {/* No language control on this step: it is one field in the same flow as
            the form behind it, where the choice is made in the Language select.
            Someone who wants to change it here goes back a step — carrying a
            second control for the few seconds this step lasts put the same
            setting in two different shapes. */}
        <div className="flex-1 overflow-y-auto pt-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmation.title')}</h1>
          <hr className="border-dashed border-gray-200 mb-8" />
          <p className="text-sm text-gray-500 mb-6">
            {t('signIn.codeSentTo', { phone: initialPhone })}
          </p>
          <div>
            <label htmlFor="invite-otp" className="block text-xs font-semibold text-gray-700 mb-2">
              {t('signIn.codeLabel')}
            </label>
            <input
              id="invite-otp"
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
          <button
            type="button"
            onClick={handleResendOtp}
            disabled={resending || resendCooldown > 0}
            className="mt-3 block w-full text-center text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            {resendCooldown > 0
              ? t('signIn.resendCodeCooldown', { seconds: resendCooldown })
              : t('signIn.resendCodeButton')}
          </button>
        </div>
        <div className="pb-8 shrink-0">
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length !== 6}
            className="w-full rounded-xl bg-tenant-primary py-4 text-sm font-semibold text-white transition-colors hover:bg-tenant-primary-hover disabled:opacity-50"
          >
            {loading ? t('signIn.verifying') : t('signIn.verifyButton')}
          </button>
        </div>
      </main>
    )
  }

  // fill-form state
  return (
    <main className="flex h-dvh flex-col max-w-sm mx-auto px-6">
      <div className="flex-1 overflow-y-auto pt-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">{t('confirmation.title')}</h1>
        <hr className="border-dashed border-gray-200 mb-8" />

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">
              {t('confirmation.phoneLabel')}
            </label>
            <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="flex-1 text-sm text-gray-700">{initialPhone}</span>
              <svg
                className="h-4 w-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            {/* No icon: this is one of three hints in the form, each sitting under
                the field it explains. Marking only the first one made it look
                more important than the other two rather than less plain. */}
            <p className="mt-2 text-xs text-gray-400 leading-relaxed">
              {t('confirmation.notificationsInfo')}
            </p>
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

          {/* Moved out of the sticky header and into the form flow, per the
              requested field order. It keeps carrying the choice on the
              confirm call rather than persisting it here — there is still no
              user row to write to while the invitee is signed out. */}
          <div>
            <label
              htmlFor="invite-language"
              className="block text-xs font-semibold text-gray-700 mb-2"
            >
              {t('confirmation.languageLabel')}
            </label>
            {/* appearance-none drops the platform caret, which sits hard against
                the field's edge and ignores its padding. The replacement is
                positioned to the same px-4 the text uses, and is pointer-events-none
                so clicking it still opens the select. */}
            <div className="relative">
              <select
                id="invite-language"
                value={language}
                onChange={(e) => handleLanguageChange(e.target.value as Locale)}
                className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-3 pr-11 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
              >
                {locales.map((loc) => (
                  <option key={loc} value={loc}>
                    {LANGUAGE_NAMES[loc]}
                  </option>
                ))}
              </select>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </div>
            <p className="mt-2 text-xs text-gray-400 leading-relaxed">
              {t('confirmation.languageHint')}
            </p>
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
                  ? 'border-tenant-primary bg-tenant-primary-tint'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  available ? 'border-tenant-primary bg-tenant-primary' : 'border-gray-300'
                }`}
              >
                {available && (
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
              <span className="text-gray-700">{t('confirmation.availabilityCheck')}</span>
            </button>
            {/* Sits with the availability choice, not at the foot of the form:
                "I am available" reads as all-or-nothing, and this is the point
                where someone who cannot do the whole event would otherwise
                hesitate. The feature it points at is MYSCH-01's time off. */}
            <p className="mt-2 text-xs text-gray-400 leading-relaxed">
              {t('confirmation.availabilityTimeOffHint')}
            </p>
          </div>

          {/* A <p>, not a <label>: the two labels below already point at the
              checkbox, and a third would compete with them for its accessible
              name. The group is tied to it with aria-labelledby instead, so
              this reads as a heading over the block rather than a second
              clickable target. */}
          <div>
            <p id="privacy-heading" className="block text-xs font-semibold text-gray-700 mb-2">
              {t('confirmation.privacyLabel')}
            </p>
            <div
              aria-labelledby="privacy-heading"
              className={`w-full flex items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                privacyAccepted
                  ? 'border-tenant-primary bg-tenant-primary-tint'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <input
                id="privacy-accepted"
                type="checkbox"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="privacy-accepted"
                className="mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-gray-300 transition-colors peer-checked:border-tenant-primary peer-checked:bg-tenant-primary peer-focus-visible:ring-2 peer-focus-visible:ring-tenant-primary peer-focus-visible:ring-offset-2"
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
              </label>
              <span className="text-gray-700">
                <label htmlFor="privacy-accepted" className="cursor-pointer">
                  {t('confirmation.privacyCheckPrefix')}
                </label>{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-900"
                >
                  {t('confirmation.privacyCheckLinkText')}
                </a>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pb-8 pt-6 shrink-0">
        <button
          onClick={handleConfirmAvailability}
          disabled={!available || !privacyAccepted || !name.trim() || loading}
          className="w-full rounded-xl bg-tenant-primary py-4 text-sm font-semibold text-white transition-colors hover:bg-tenant-primary-hover disabled:opacity-50"
        >
          {loading ? t('confirmation.confirming') : t('confirmation.confirmButton')}
        </button>
      </div>
    </main>
  )
}
