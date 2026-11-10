'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Checkbox } from '@heroui/react'
import { Camera, Check, CircleAlert, CircleCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { AvatarImage } from '@/components/ui/avatar-image'
import { IceContactFields } from '@/components/ice-contact-fields'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useTranslation } from '@/lib/i18n/client'
import type { Locale } from '@/lib/i18n/config'
import { authErrorKey, isExpectedAuthError } from '@/lib/auth/auth-error-keys'
import { formatPhoneForDisplay, normalizeSmsPhone } from '@/lib/phone'
import {
  EMPTY_ICE_CONTACT_INPUT,
  isIceContactEmpty,
  normalizeIceContact,
  type IceContact,
  type IceContactInput,
} from '@/lib/ice-contact'
import { resizeImage } from '@/lib/image/resize-image'
import { logger } from '@/lib/logger'
import { toastError } from '@/lib/toast'
import type { ClaimPrefill } from '@/lib/participants/claim-prefill'

import { ParticipantIdentity } from './participant-identity'

const RESEND_COOLDOWN_SECONDS = 30

interface Props {
  token: string
  event: { name: string; logoUrl: string | null }
  participant: { id: string; bib: string | null; name: string | null }
  listHref: string
  /**
   * N42: someone else already holds this record. The runner goes through the
   * same steps, and Complete stores a claim conflict for an admin instead of
   * claiming. Set from the server; the server decides again on Complete, so
   * a record claimed while this form was open also ends as a conflict.
   */
  conflict?: boolean
}

type ApiResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; status: number; code?: string }

async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, ...(data as T) }
    return { ok: false, status: res.status, code: data.code }
  } catch {
    return { ok: false, status: 0 }
  }
}

function iceToInput(contact: IceContact | null): IceContactInput {
  if (!contact) return EMPTY_ICE_CONTACT_INPUT
  return {
    phone: contact.phone ? formatPhoneForDisplay(contact.phone) : '',
    name: contact.name ?? '',
    relation: contact.relation ?? '',
  }
}

/**
 * CLAIM-02 (N40), mobile first. One form, as in the wireframes: the number is
 * verified in place (Send code, then Verify), and Complete only enables once
 * the number is verified and both required boxes are ticked.
 *
 * The order of server calls:
 *   1. /api/claim/send-otp   — signed out; rate-limited per number and list
 *   2. /api/auth/verify-otp  — the sign-in route itself; sets the session
 *   3. /api/claim/prefill    — existing account? already in this event?
 *   4. /api/claim/complete   — the claim, with consent, in one transaction
 *   5. /api/claim/photo      — optional, after the claim, never blocking it
 *
 * Verifying signs the runner in before Complete. That is what lets step 3
 * read their own rows through RLS, and it is harmless if they stop there: an
 * account with no participant link has no role and no event (L26), and the
 * next visit to this page simply continues.
 */
export default function ClaimForm({
  token,
  event,
  participant,
  listHref,
  conflict = false,
}: Props) {
  const { t, i18n } = useTranslation('auth')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'form' | 'done' | 'conflict'>('form')

  // ---- number and code ----
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  // The normalized number the code was sent to. Editing the field afterwards
  // clears it, so a code is never verified against a different number.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verified, setVerified] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  // Shown inline under the field it belongs to, as in the rate-limited and
  // already-participant-in-event wireframes, rather than as a toast that is
  // gone before it is read.
  const [numberNotice, setNumberNotice] = useState<string | null>(null)

  // ---- what the server knows after verification ----
  const [prefill, setPrefill] = useState<ClaimPrefill | null>(null)

  // ---- required boxes ----
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  // checkbox-missing: "Required" only after a Complete attempt, not while the
  // runner is still on their way down the form.
  const [attempted, setAttempted] = useState(false)

  // ---- optional ----
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [ice, setIce] = useState<IceContactInput>(EMPTY_ICE_CONTACT_INPUT)
  const [icePhoneError, setIcePhoneError] = useState<string | null>(null)
  const [language, setLanguage] = useState<Locale>(i18n.language as Locale)
  const [languageChosen, setLanguageChosen] = useState(false)

  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  const participantName = participant.name ?? participant.bib ?? ''
  const blockedInEvent = prefill?.alreadyInEvent === true
  const canComplete =
    verified && identityConfirmed && privacyAccepted && !blockedInEvent && !completing

  // ------------------------------------------------------------------------

  function handlePhoneChange(value: string) {
    setPhoneInput(value)
    setPhoneError(null)
    if (sentTo) {
      setSentTo(null)
      setCode('')
    }
    setNumberNotice(null)
  }

  async function sendCode() {
    if (sending || cooldown > 0 || verified) return
    const normalized = normalizeSmsPhone(phoneInput)
    if (!normalized.ok) {
      setPhoneError(
        normalized.error === 'unsupported_country'
          ? t('claim.phoneUnsupportedCountry')
          : t('claim.phoneInvalid')
      )
      return
    }

    setSending(true)
    setNumberNotice(null)
    const result = await postJson('/api/claim/send-otp', {
      token,
      participantId: participant.id,
      phone: normalized.phone,
    })
    setSending(false)

    if (result.ok) {
      setSentTo(normalized.phone)
      setCode('')
      setCooldown(RESEND_COOLDOWN_SECONDS)
      return
    }
    if (result.status === 429 || result.code === 'over_sms_send_rate_limit') {
      setNumberNotice(t('claim.rateLimited'))
      return
    }
    if (result.code === 'already_claimed' || result.code === 'not_open') {
      // Something changed since the page loaded; the page itself now shows
      // the right dead end.
      router.refresh()
      return
    }
    const details = { code: result.code, status: result.status }
    if (isExpectedAuthError(result.code)) logger.warn('[claim] send code failed', details)
    else logger.error('[claim] send code failed', undefined, details)
    toastError(result.code ? t(authErrorKey(result.code)) : t('claim.failed'))
  }

  async function verifyCode() {
    if (!sentTo || code.length !== 6 || verifying) return
    setVerifying(true)
    setNumberNotice(null)

    const verify = await postJson('/api/auth/verify-otp', { phone: sentTo, token: code })
    if (!verify.ok) {
      setVerifying(false)
      if (verify.status === 429) setNumberNotice(t('claim.rateLimited'))
      else toastError(t('signIn.invalidCode'))
      return
    }

    const result = await postJson<{ prefill: ClaimPrefill }>('/api/claim/prefill', {
      token,
      participantId: participant.id,
    })
    setVerifying(false)
    setVerified(true)

    if (!result.ok) {
      if (result.code === 'already_claimed' || result.code === 'not_open') {
        router.refresh()
        return
      }
      // The number is verified; only the prefill is missing. Complete still
      // works, and the server re-checks everything the prefill would warn of.
      logger.warn('[claim] prefill failed', { status: result.status, code: result.code })
      return
    }

    const p = result.prefill
    setPrefill(p)
    if (p.alreadyInEvent) setNumberNotice(t('claim.alreadyInEvent'))
    // Fill only what the runner has not typed themselves.
    if (p.ice) {
      const saved = p.ice
      setIce((current) =>
        current.phone || current.name || current.relation ? current : iceToInput(saved)
      )
    }
    if (p.language && !languageChosen && p.language !== language) {
      setLanguage(p.language)
      i18n.changeLanguage(p.language)
    }
  }

  function handleLanguageChange(next: Locale) {
    setLanguage(next)
    setLanguageChosen(true)
  }

  function handleIceChange(next: IceContactInput) {
    if (next.phone !== ice.phone) setIcePhoneError(null)
    setIce(next)
  }

  function validateIce(): boolean {
    if (normalizeIceContact(ice).ok) return true
    setIcePhoneError(t('iceContact.invalidPhone', { ns: 'common' }))
    return false
  }

  function handlePhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  async function uploadPhoto(file: File): Promise<boolean> {
    try {
      const { file: upload } = await resizeImage(file, 'avatar')
      const form = new FormData()
      form.append('token', token)
      form.append('participantId', participant.id)
      form.append('file', upload)
      const res = await fetch('/api/claim/photo', { method: 'POST', body: form })
      return res.ok
    } catch {
      return false
    }
  }

  async function complete() {
    setAttempted(true)
    if (!canComplete) return
    if (!validateIce()) return

    setCompleting(true)
    const normalizedIce = normalizeIceContact(ice)
    const result = await postJson<{
      outcome: 'claimed' | 'conflict'
      roleGranted: boolean
    }>('/api/claim/complete', {
      token,
      participantId: participant.id,
      identityConfirmed: true,
      privacyAccepted: true,
      // Only a real choice is stored, so a missing preference keeps meaning
      // "never chose" — the same rule as the invite form and sign-in.
      ...(languageChosen ? { language } : {}),
      ...(normalizedIce.ok && !isIceContactEmpty(normalizedIce.contact) ? { ice } : {}),
      // Keep the photo they already have, unless they picked a new one.
      keepExistingPhoto: !photo && Boolean(prefill?.avatarUrl),
    })

    if (!result.ok) {
      setCompleting(false)
      if (result.code === 'already_in_event') {
        setPrefill((p) => (p ? { ...p, alreadyInEvent: true } : p))
        setNumberNotice(t('claim.alreadyInEvent'))
      } else if (result.code === 'already_claimed' || result.code === 'not_open') {
        router.refresh()
      } else if (result.code === 'invalid_ice_phone') {
        setIcePhoneError(t('iceContact.invalidPhone', { ns: 'common' }))
      } else {
        logger.error('[claim] complete failed', undefined, {
          status: result.status,
          code: result.code,
        })
        toastError(t('claim.failed'))
      }
      return
    }

    // N42: stored for the organisers; no access, so no photo either — the
    // record it would go on is not theirs.
    if (result.outcome === 'conflict') {
      setCompleting(false)
      setStep('conflict')
      return
    }

    if (photo && !(await uploadPhoto(photo))) {
      toastError(t('claim.photoFailed'))
    }
    setCompleting(false)
    setStep('done')
  }

  // ------------------------------------------------------------------------

  if (step === 'done') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-10">
        <h1 className="text-[22px] font-bold leading-snug text-ink">{t('claim.title')}</h1>
        <div className="mt-6">
          <ParticipantIdentity bib={participant.bib} name={participant.name} showLabel={false} />
        </div>
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center"
          role="status"
        >
          <CircleCheck className="size-14 text-tenant-primary" strokeWidth={1.5} aria-hidden />
          <p className="text-[17px] font-semibold text-ink">{t('claim.completedTitle')}</p>
          <p className="max-w-xs text-[15px] leading-relaxed text-ink-soft">
            {t('claim.completedBody', { name: participantName, event: event.name })}
          </p>
        </div>
        <Button
          color="primary"
          size="lg"
          fullWidth
          onPress={() => {
            // Post-login routing decides where "my page" is: the participant
            // landing page (N43), or the event picker for someone who is
            // also an official.
            router.push('/')
            router.refresh()
          }}
        >
          {t('claim.goToMyPage')}
        </Button>
      </main>
    )
  }

  // CLAIM-02 conflict-submitted (N42): the card's exact message, nothing about
  // the current claimant.
  if (step === 'conflict') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-10">
        <h1 className="text-[22px] font-bold leading-snug text-ink">{t('claim.title')}</h1>
        <div className="mt-6">
          <ParticipantIdentity bib={participant.bib} name={participant.name} showLabel={false} />
        </div>
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center"
          role="status"
        >
          <CircleAlert className="size-14 text-ink-label" strokeWidth={1.5} aria-hidden />
          <p className="max-w-xs text-[15px] leading-relaxed text-ink-soft">
            {t('claim.conflictSubmitted')}
          </p>
        </div>
        <Button as={Link} href={listHref} variant="light" size="lg" fullWidth>
          {t('claim.backToList')}
        </Button>
      </main>
    )
  }

  const shownPhoto = photoPreview ?? prefill?.avatarUrl ?? null
  const initials =
    participantName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-10">
      <div className="flex-1">
        {prefill?.existingAccount && !prefill.alreadyInEvent ? (
          <p
            className="mb-5 rounded-2xl bg-status-neutral-bg px-4 py-3 text-[14px] leading-relaxed text-ink-soft"
            role="status"
          >
            {t('claim.welcomeBack')}
          </p>
        ) : null}

        <p className="text-[13px] font-medium text-ink-label">{event.name}</p>
        <h1 className="mt-1 text-[22px] font-bold leading-snug text-ink">{t('claim.title')}</h1>

        <div className="mt-5">
          <ParticipantIdentity bib={participant.bib} name={participant.name} />
        </div>

        {conflict ? (
          <div
            className="mt-5 rounded-2xl bg-status-neutral-bg px-4 py-3 text-[14px] leading-relaxed text-ink-soft"
            role="note"
          >
            <p className="font-semibold text-ink">{t('claim.alreadyClaimedTitle')}</p>
            <p className="mt-1">{t('claim.conflictIntro')}</p>
            <p className="mt-2">
              {t('claim.conflictOwnClaim')}{' '}
              <Link href="/login" className="font-medium text-ink underline underline-offset-2">
                {t('claim.signIn')}
              </Link>
            </p>
          </div>
        ) : null}

        {/* ---- Mobile number (L2: the only required field) ---- */}
        <section className="mt-6">
          <label htmlFor="claim-phone" className="mb-2 block text-[13px] font-semibold text-ink">
            {t('claim.phoneLabel')}{' '}
            <span aria-hidden="true" className="text-ink-label">
              *
            </span>
            <span className="sr-only">({t('claim.requiredMark')})</span>
          </label>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id="claim-phone"
                // HeroUI derives aria-label from the placeholder when it has no
                // label prop of its own, and that overrides <label htmlFor>:
                // a screen reader would read "070 123 45 67". Name it outright.
                aria-label={t('claim.phoneLabel')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('claim.phonePlaceholder')}
                value={phoneInput}
                onValueChange={handlePhoneChange}
                onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                isReadOnly={verified}
                isInvalid={Boolean(phoneError)}
                errorMessage={phoneError ?? undefined}
                endContent={
                  verified ? (
                    <Check
                      className="size-4 text-status-ok-text"
                      aria-label={t('claim.verified')}
                    />
                  ) : null
                }
              />
            </div>
            {verified ? null : (
              <Button
                variant="bordered"
                className="h-10 shrink-0"
                onPress={sendCode}
                isLoading={sending}
                isDisabled={!phoneInput.trim() || cooldown > 0}
              >
                {sentTo
                  ? cooldown > 0
                    ? t('claim.sendAgainCooldown', { seconds: cooldown })
                    : t('claim.sendAgain')
                  : t('claim.sendCode')}
              </Button>
            )}
          </div>
          {!sentTo && !verified && !phoneError ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink-label">
              {t('claim.phoneHint')}
            </p>
          ) : null}

          {sentTo && !verified ? (
            <div className="mt-4">
              <p className="mb-2 text-[13px] leading-relaxed text-ink-soft" role="status">
                {t('claim.codeSentTo', { phone: formatPhoneForDisplay(sentTo) })}
              </p>
              <label htmlFor="claim-code" className="mb-2 block text-[13px] font-semibold text-ink">
                {t('claim.codeLabel')}
              </label>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    id="claim-code"
                    aria-label={t('claim.codeLabel')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder={t('claim.codePlaceholder')}
                    value={code}
                    onValueChange={(v) => setCode(v.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
                    autoFocus
                  />
                </div>
                <Button
                  variant="bordered"
                  className="h-10 shrink-0"
                  onPress={verifyCode}
                  isLoading={verifying}
                  isDisabled={code.length !== 6}
                >
                  {t('claim.verify')}
                </Button>
              </div>
            </div>
          ) : null}

          {numberNotice ? (
            <p
              className="mt-3 rounded-xl border border-edge border-l-4 border-l-ink px-4 py-3 text-[14px] leading-relaxed text-ink"
              role="alert"
            >
              {numberNotice}
            </p>
          ) : null}
        </section>

        {/* ---- Required boxes (L7, consent) ---- */}
        <section className="mt-6 flex flex-col gap-3">
          <div>
            <Checkbox
              isSelected={identityConfirmed}
              onValueChange={setIdentityConfirmed}
              isDisabled={blockedInEvent}
              classNames={{ label: 'text-[15px] text-ink' }}
            >
              {t('claim.confirmIdentity')}{' '}
              <span aria-hidden="true" className="text-ink-label">
                *
              </span>
            </Checkbox>
            {attempted && !identityConfirmed ? (
              <p className="ml-7 mt-1 text-[13px] font-semibold text-ink">{t('claim.required')}</p>
            ) : null}
          </div>
          <div>
            <Checkbox
              isSelected={privacyAccepted}
              onValueChange={setPrivacyAccepted}
              isDisabled={blockedInEvent}
              classNames={{ label: 'text-[15px] text-ink' }}
            >
              {t('confirmation.privacyCheckPrefix')}{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                {t('confirmation.privacyCheckLinkText')}
              </a>{' '}
              <span aria-hidden="true" className="text-ink-label">
                *
              </span>
            </Checkbox>
            {attempted && !privacyAccepted ? (
              <p className="ml-7 mt-1 text-[13px] font-semibold text-ink">{t('claim.required')}</p>
            ) : null}
          </div>
        </section>

        {/* ---- Optional: photo (L8, encouraged), ICE, language ---- */}
        <section className="mt-8">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-label">
            {t('claim.optional')}
          </h2>

          {conflict ? null : (
            <div className="mt-3 flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoPick}
                className="sr-only"
                id="claim-photo"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={shownPhoto ? t('claim.photoChange') : t('claim.photoAdd')}
                className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-tenant-primary focus-visible:ring-offset-2"
              >
                <AvatarImage
                  src={shownPhoto}
                  initials={initials}
                  alt=""
                  className="h-16 w-16 bg-status-neutral-bg"
                  initialsClassName="text-lg font-semibold text-ink-soft"
                />
                <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-tenant-primary text-white">
                  <Camera className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
                </span>
              </button>
              <p className="text-[14px] leading-relaxed text-ink-soft">
                {photoPreview
                  ? t('claim.photoChange')
                  : prefill?.avatarUrl
                    ? t('claim.photoKept')
                    : t('claim.photoAdd')}
              </p>
            </div>
          )}

          <div className={conflict ? 'mt-3' : 'mt-6'}>
            <p className="mb-2 text-[13px] font-semibold text-ink">
              {t('iceContact.heading', { ns: 'common' })}
            </p>
            <IceContactFields
              value={ice}
              onChange={handleIceChange}
              onBlur={validateIce}
              phoneError={icePhoneError}
              idPrefix="claim-ice"
            />
          </div>

          <div className="mt-6">
            <p className="mb-2 text-[13px] font-semibold text-ink">{t('claim.languageLabel')}</p>
            {/* key: remount when the prefill sets the account's language, so
                the switcher's own state follows it. */}
            <LanguageSwitcher
              key={prefill?.language ?? 'page'}
              current={language}
              persist={false}
              onChange={handleLanguageChange}
              variant="solid"
              fill
            />
          </div>
        </section>
      </div>

      <div className="mt-10">
        {!canComplete && !completing && !blockedInEvent ? (
          <p className="mb-3 text-center text-[13px] leading-relaxed text-ink-label">
            {t('claim.completeHint')}
          </p>
        ) : null}
        <Button
          color="primary"
          size="lg"
          fullWidth
          onPress={complete}
          isLoading={completing}
          // Disabled until verified (nothing to submit yet), and while the
          // number is blocked in this event. With a verified number and a
          // missing box it stays pressable, so the press can say which box
          // (checkbox-missing).
          isDisabled={!verified || blockedInEvent || completing}
        >
          {completing ? t('claim.completing') : t('claim.complete')}
        </Button>
        <p className="mt-3 text-center">
          <a href={listHref} className="text-[13px] text-ink-soft underline underline-offset-2">
            {t('claim.backToList')}
          </a>
        </p>
      </div>
    </main>
  )
}
