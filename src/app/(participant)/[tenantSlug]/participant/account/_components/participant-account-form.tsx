'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Calendar, ChevronRight, ExternalLink, FileText, LogOut } from 'lucide-react'
import { Switch } from '@heroui/react'
import { Input } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { LogoutButton } from '@/components/logout-button'
import { IceContactFields } from '@/components/ice-contact-fields'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useTranslation } from '@/lib/i18n/client'
import { useAutosave } from '@/lib/hooks/use-autosave'
import { useIceContactEditor } from '@/lib/hooks/use-ice-contact-editor'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
import type { IceContact } from '@/lib/ice-contact'
import type { Locale } from '@/lib/i18n/config'

export interface MyRaceEntry {
  eventId: string
  eventName: string
  stageNames: string[]
  bib: string | null
  category: string | null
  raceResultsUrl: string | null
}

interface Props {
  tenantId: string
  name: string
  phone: string
  smsOptOut: boolean
  iceContact: IceContact | null
  myRace: MyRaceEntry[]
  language: Locale
  // The official surface, for a participant who is also an official here
  // ("Schedule section only if also an official"). null otherwise.
  officialHref: string | null
}

// N43: ACCT-01, participant variant. Same autosave model as the official
// screen — every control saves on its own, one status line for the form — and
// the same section order and spacing, so a user who is both does not meet two
// different account screens.
//
// What a participant cannot change is shown, not edited: the name is the Race
// Results name (L14) and the race facts come from the import. There is no
// account name of their own to edit, and no photo here (CLAIM-02 takes it).
export function ParticipantAccountForm({
  tenantId,
  name,
  phone,
  smsOptOut: initialSmsOptOut,
  iceContact,
  myRace,
  language,
  officialHref,
}: Props) {
  const { t } = useTranslation('official')
  const { t: tCommon } = useTranslation('common')

  const [smsOptOut, setSmsOptOut] = useState(initialSmsOptOut)
  const smsOptOutRef = useRef(initialSmsOptOut)

  const ice = useIceContactEditor(iceContact, () => toastError(t('account.saveError')))

  const smsSave = useAutosave<void>({
    onSave: async () => {
      const res = await fetch('/api/account/participant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, smsOptOut: smsOptOutRef.current }),
      })
      if (!res.ok) throw new Error('Save failed')
    },
    delay: 0,
    onError: () => toastError(t('account.saveError')),
  })

  function handleToggle(isSelected: boolean) {
    const next = !isSelected
    setSmsOptOut(next)
    smsOptOutRef.current = next
    smsSave.queue()
  }

  const statuses = [smsSave.status, ice.status]
  const status = statuses.includes('saving')
    ? 'saving'
    : statuses.includes('error')
      ? 'error'
      : statuses.includes('saved')
        ? 'saved'
        : 'idle'

  const readOnlyField = {
    inputWrapper: '!bg-surface !border-edge',
    input: 'cursor-default !text-ink-muted',
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="mb-8">
        <Input
          label={t('participant.account.nameLabel')}
          value={name}
          labelPlacement="outside"
          isReadOnly
          description={t('participant.account.nameHint')}
          classNames={readOnlyField}
        />
      </div>

      <div className="mb-8">
        <Input
          label={t('account.phoneLabel')}
          value={formatPhoneForDisplay(phone)}
          labelPlacement="outside"
          isReadOnly
          classNames={readOnlyField}
        />
      </div>

      {/* N37: ICE contact, right under the person's own number as on the
          official screen. Organisers read it from PART-01 (N41). */}
      <p className="section-label mb-2.5">{tCommon('iceContact.heading')}</p>
      <div className="mb-2">
        <IceContactFields
          value={ice.value}
          onChange={ice.onChange}
          onBlur={ice.onBlur}
          phoneError={ice.phoneError}
          idPrefix="participant-ice"
        />
      </div>
      {/* Reserved height so the cards below do not jump as saves come and go. */}
      <p
        aria-live="polite"
        className={`mb-6 h-5 text-sm ${status === 'error' ? 'text-danger' : 'text-ink-muted'}`}
      >
        {status === 'saving'
          ? t('account.saving')
          : status === 'saved'
            ? t('account.saved')
            : status === 'error'
              ? t('account.saveError')
              : ''}
      </p>

      {/* My race: read-only facts from the import, one card per event. Shown
          whether or not the event is open — this is the runner's own record,
          and My account stays reachable while an event is closed (PB10). */}
      <p className="section-label mb-2.5">{t('participant.account.myRace')}</p>
      <div className="mb-8 flex flex-col gap-3">
        {myRace.map((entry) => {
          const facts = [
            ...entry.stageNames,
            entry.bib ? `${t('participant.home.bib')} ${entry.bib}` : null,
            entry.category ? `${t('participant.home.category')} ${entry.category}` : null,
          ].filter(Boolean)
          return (
            <AppCard key={entry.eventId} bodyClassName="px-4 py-4">
              {myRace.length > 1 ? (
                <p className="text-[15px] font-semibold text-ink">{entry.eventName}</p>
              ) : null}
              {facts.length > 0 ? (
                <p className="text-[15px] text-ink-muted">{facts.join(' · ')}</p>
              ) : null}
              {entry.raceResultsUrl ? (
                <a
                  href={entry.raceResultsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[15px] font-semibold text-tenant-primary hover:underline"
                >
                  {t('participant.home.myResults')}
                  <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden="true" />
                </a>
              ) : null}
            </AppCard>
          )
        })}
      </div>

      <p className="section-label mb-2.5">{t('account.notificationsHeading')}</p>
      <AppCard className="mb-8" bodyClassName="px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-semibold text-ink">{t('account.smsUpdatesLabel')}</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {smsOptOut ? t('account.smsUpdatesHintOff') : t('account.smsUpdatesHintOn')}
            </p>
          </div>
          {/* isSelected=true means SMS ON (smsOptOut=false) */}
          <Switch
            isSelected={!smsOptOut}
            onValueChange={handleToggle}
            color="primary"
            aria-label={t('account.smsUpdatesLabel')}
          />
        </div>
      </AppCard>

      <p className="section-label mb-2.5">{tCommon('language.label')}</p>
      <AppCard className="mb-8" bodyClassName="px-4 py-4">
        {/* Same row as the official account screen: in a flex-col the
            switcher stretched to the card's full width. */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[15px] font-semibold text-ink">{t('account.languageLabel')}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{t('account.languageHint')}</p>
          </div>
          <LanguageSwitcher current={language} variant="solid" />
        </div>
      </AppCard>

      {officialHref ? (
        <>
          <p className="section-label mb-2.5">{t('participant.account.myShiftsHeading')}</p>
          <Link
            href={officialHref}
            className={`mb-8 flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:bg-surface`}
          >
            <Calendar
              aria-hidden="true"
              strokeWidth={1.7}
              className="size-8 shrink-0 text-tenant-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">
                {t('participant.account.myShifts')}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {t('participant.account.myShiftsSub')}
              </p>
            </div>
            <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-tenant-primary" />
          </Link>
        </>
      ) : null}

      <p className="section-label mb-2.5">{t('account.privacyHeading')}</p>
      <a
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className={`mb-6 flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:bg-surface`}
      >
        <FileText
          aria-hidden="true"
          strokeWidth={1.7}
          className="size-8 shrink-0 text-tenant-primary"
        />
        <p className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
          {t('account.privacyPolicy')}
          <span className="sr-only"> {tCommon('privacyPage.opensInNewTab')}</span>
        </p>
        <ExternalLink
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-5 shrink-0 text-ink-label"
        />
      </a>

      <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-control border-1 border-edge bg-white px-4 py-3 text-[15px] font-semibold text-ink-soft transition-colors hover:border-edge-field hover:text-ink">
        <LogOut className="size-4 shrink-0" strokeWidth={2} />
        {t('account.logOut')}
      </LogoutButton>
    </div>
  )
}
