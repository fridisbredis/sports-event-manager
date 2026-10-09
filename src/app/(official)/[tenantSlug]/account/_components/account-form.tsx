'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight, FileText, LogOut } from 'lucide-react'
import { Switch } from '@heroui/react'
import { Input } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { LogoutButton } from '@/components/logout-button'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'
import { useAutosave } from '@/lib/hooks/use-autosave'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
import { LanguageSwitcher } from '@/components/language-switcher'
import type { Locale } from '@/lib/i18n/config'
import { AvatarPicker } from './avatar-picker'

interface AccountFormProps {
  name: string
  avatarUrl: string | null
  phone: string
  smsOptOut: boolean
  tenantId: string
  tenantSlug: string
  assignmentCount: number
  i18nNamespace: 'official' | 'admin'
  language: Locale
  layout?: 'mobile' | 'desktop'
}

export default function AccountForm({
  name: initialName,
  avatarUrl,
  phone,
  smsOptOut: initialSmsOptOut,
  tenantId,
  tenantSlug,
  assignmentCount,
  i18nNamespace,
  language,
  layout = 'mobile',
}: AccountFormProps) {
  const { t } = useTranslation(i18nNamespace)
  // The section heading is shared with every other language control in the
  // app, so it lives in `common` rather than being duplicated per namespace.
  const { t: tCommon } = useTranslation('common')

  const [name, setName] = useState(initialName)
  const [smsOptOut, setSmsOptOut] = useState(initialSmsOptOut)

  // The route validates name and smsOptOut as one object, so every write
  // carries both. Reading them from refs rather than from state keeps a save
  // triggered by one control from sending a stale value for the other: the
  // ref is current the moment its setter runs, while the state variable
  // captured in this render is not.
  const nameRef = useRef(initialName)
  const smsOptOutRef = useRef(initialSmsOptOut)

  // The last name the server accepted. Typing a letter and deleting it again
  // lands back here, and that should produce no write and no "Saved" for a
  // change that was never made. The switch needs no equivalent: it cannot
  // return to its stored value except by a second deliberate click, which is
  // a real change and should be written.
  const savedName = useRef(initialName)

  async function persist() {
    const res = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        name: nameRef.current,
        smsOptOut: smsOptOutRef.current,
      }),
    })

    if (!res.ok) throw new Error('Save failed')

    savedName.current = nameRef.current
  }

  // Typing is debounced; the switch writes on the spot. A half-typed name is a
  // value worth not sending, a half-flipped switch is not a thing.
  const nameSave = useAutosave<void>({
    onSave: persist,
    delay: 800,
    onError: () => toastError(t('account.saveError')),
  })

  const toggleSave = useAutosave<void>({
    onSave: persist,
    delay: 0,
    onError: () => toastError(t('account.saveError')),
  })

  function handleNameChange(value: string) {
    setName(value)
    nameRef.current = value
    // An empty name fails the route's min(1) and would only produce a toast on
    // a field the user is still in the middle of clearing. Wait for something
    // to save; blur restores the stored name if they leave it empty.
    //
    // cancel() rather than a bare return in both cases: an earlier keystroke
    // may already have a timer running, and letting it fire would write a
    // value the user has since backed out of.
    if (value.trim() === '' || value === savedName.current) {
      nameSave.cancel()
      return
    }
    nameSave.queue()
  }

  function handleNameBlur() {
    // Leaving the field empty is not an edit, it is an unfinished one. Put the
    // stored name back rather than holding a value the server will refuse.
    if (name.trim() === '') {
      setName(savedName.current)
      nameRef.current = savedName.current
      return
    }
    // Overtake the debounce timer: the user has moved on and expects the edit
    // to be in by the time they look at something else.
    nameSave.flush()
  }

  function handleToggle(isSelected: boolean) {
    const next = !isSelected
    setSmsOptOut(next)
    smsOptOutRef.current = next
    toggleSave.queue()
  }

  // One line for the whole form rather than one per control: two independent
  // "Saved" markers on a screen this short read as two different things having
  // happened. 'saving' wins over 'saved' so a new edit replaces the previous
  // confirmation instead of flickering between them.
  const status =
    nameSave.status === 'saving' || toggleSave.status === 'saving'
      ? 'saving'
      : nameSave.status === 'error' || toggleSave.status === 'error'
        ? 'error'
        : nameSave.status === 'saved' || toggleSave.status === 'saved'
          ? 'saved'
          : 'idle'

  const isDesktop = layout === 'desktop'

  return (
    <>
      {isDesktop && (
        <div className="mb-8 flex items-center justify-between">
          <h1 className="page-title">{t('account.title')}</h1>
          <SaveStatus status={status} t={t} />
        </div>
      )}
      {/* With the fixed Save bar gone, the only thing to clear at the foot of
          the mobile screen is the tab bar itself. The layout already reserves
          that with pb-16; pb-8 here is the screen's own breathing room below
          the log-out button, not a clearance. */}
      <div className={isDesktop ? 'max-w-lg' : 'px-5 pt-10 pb-8'}>
        {/* Avatar — clickable, opens a file picker and uploads on pick.
            AvatarPicker centres itself. */}
        <div className="mb-6">
          <AvatarPicker
            avatarUrl={avatarUrl}
            name={name}
            tenantId={tenantId}
            i18nNamespace={i18nNamespace}
          />
        </div>

        {/* Name field. The "Edit" affordance sits inside the field, at its
            trailing edge, rather than as a description line underneath — it
            reads as part of the control it applies to, and keeps the label /
            field / label / field rhythm with the phone row below unbroken.
            It is a hint, not a control: the input is always editable, so it
            carries aria-hidden and no press target of its own. */}
        <div className="mb-5">
          <Input
            label={t('account.nameLabel')}
            value={name}
            onValueChange={handleNameChange}
            labelPlacement="outside"
            endContent={
              <span
                aria-hidden="true"
                className="shrink-0 text-[15px] font-semibold text-tenant-primary"
              >
                {t('account.editHint')}
              </span>
            }
            onBlur={handleNameBlur}
          />
          {/* Mobile has no header to put this in, so it sits under the field
              it most often describes. Reserved height, so the card below does
              not jump a line each time a save starts and finishes. */}
          {!isDesktop && <SaveStatus status={status} t={t} className="mt-1.5 h-5" />}
        </div>

        {/* Phone field. A real Input rather than a hand-rolled label over a
            div: as two separate elements its label took Tailwind's `text-sm`
            while the name field's took HeroUI's `text-small`, which the iOS
            zoom fix raises on touch devices — so the two labels matched on
            desktop and differed by 2px on a phone. Going through the shared
            wrapper means there is one label style here, not two.

            Grey rather than white: it is the one field on the screen that
            cannot be typed in, and the flat grey says so before the
            "(read-only)" in the label has to. isReadOnly (not isDisabled)
            keeps it focusable and readable by assistive tech — the number is
            information the official may well want to select and copy, and a
            disabled field is skipped in the tab order and announced as
            unavailable. */}
        <div className="mb-8">
          <Input
            label={t('account.phoneLabel')}
            value={formatPhoneForDisplay(phone)}
            labelPlacement="outside"
            isReadOnly
            classNames={{
              inputWrapper: '!bg-surface !border-edge',
              input: 'cursor-default !text-ink-muted',
            }}
          />
        </div>

        {/* Notifications section */}
        <p className="section-label mb-3">{t('account.notificationsHeading')}</p>
        {/* On desktop this card is followed by the Schedule section, and the
            wider gap separates two sections. On mobile it is the last card
            and the only thing after it is the log-out button, which needs
            less air than a section break. */}
        <AppCard className={isDesktop ? 'mb-8' : 'mb-6'} bodyClassName="px-4 py-4">
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

        {/* Language. Saves on click through its own endpoint rather than
            joining the Save button above: the name and SMS fields are one
            tenant-scoped write, while language is per user and applies
            everywhere. Switching it re-renders the page, which would
            discard an unsaved name edit — so it is deliberately a separate
            section, not another row in the card above. */}
        <p className="section-label mb-3">{tCommon('language.label')}</p>
        <AppCard className={isDesktop ? 'mb-8' : 'mb-6'} bodyClassName="px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-semibold text-ink">{t('account.languageLabel')}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{t('account.languageHint')}</p>
            </div>
            {/* Solid here, not the sidebars' outlined form: this is a standalone
                control on a card with no nav beside it to compete with, and both
                screens that render this form sit under a TenantThemeStyle, so the
                tenant primary fill resolves. */}
            <LanguageSwitcher current={language} variant="solid" />
          </div>
        </AppCard>

        {/* Schedule section — admin only. An official already has My schedule
            in the bottom tab bar, so the same link here is a second door to
            one room; an admin's sidebar has no equivalent, which is why this
            one shows even at zero: it is their only way in, and an admin with
            no shifts still needs to be able to look and see that. */}
        {isDesktop && (
          <>
            <p className="section-label mb-3">{t('account.scheduleHeading')}</p>
            <Link
              href={`/${tenantSlug}/schedule`}
              className={`flex items-center gap-4 ${CARD_SURFACE} mb-8 px-4 py-4 transition-colors hover:bg-surface`}
            >
              {/* A calendar, since the row leads to the schedule — the
                  empty square it replaced read as an unchecked checkbox. */}
              <CalendarDays
                aria-hidden="true"
                strokeWidth={1.7}
                className="size-8 shrink-0 text-tenant-primary"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-ink">
                  {t('account.assignmentCount', { count: assignmentCount })}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">{t('account.viewSchedule')}</p>
              </div>
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-5 shrink-0 text-ink-label"
              />
            </Link>
          </>
        )}

        {/* The only route to the privacy policy from inside the app. It is
            linked from sign-in and from the invite forms, but both of those
            are passed through once; this is where someone who already has an
            account can go back and read how their phone number is handled.
            Sits with the account's own data rather than under a heading of
            its own — it is about the same thing the fields above hold.

            A plain <a> with target="_blank", matching the invite forms: the
            page is a document to read, not a step in this screen's flow. */}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-4 ${CARD_SURFACE} ${
            isDesktop ? 'mb-8' : 'mb-6'
          } px-4 py-4 transition-colors hover:bg-surface`}
        >
          <FileText
            aria-hidden="true"
            strokeWidth={1.7}
            className="size-8 shrink-0 text-tenant-primary"
          />
          <p className="min-w-0 flex-1 text-[15px] font-semibold text-ink">
            {t('account.privacyPolicy')}
          </p>
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.5}
            className="size-5 shrink-0 text-ink-label"
          />
        </a>

        {/* Log out — official only. The admin layout already carries one at
            the foot of its sidebar, and two on the same screen is one too
            many. This is the equivalent place on a layout with no sidebar. */}
        {!isDesktop && (
          <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-control border-1 border-edge bg-white px-4 py-3 text-[15px] font-semibold text-ink-soft transition-colors hover:border-edge-field hover:text-ink">
            <LogOut className="size-4 shrink-0" strokeWidth={2} />
            {t('account.logOut')}
          </LogoutButton>
        )}
      </div>
    </>
  )
}

/**
 * The autosave counterpart to the Save button this screen used to carry.
 *
 * aria-live is polite and the region is always mounted: a status that appears
 * and disappears re-announces itself on every keystroke, where an empty live
 * region that fills and empties announces only what changed. 'idle' renders
 * nothing visible but keeps the node, which is what makes that true.
 */
function SaveStatus({
  status,
  t,
  className = '',
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  t: (key: string) => string
  className?: string
}) {
  return (
    <p
      aria-live="polite"
      className={`text-sm transition-colors ${
        status === 'error' ? 'text-danger' : 'text-ink-muted'
      } ${className}`}
    >
      {status === 'saving'
        ? t('account.saving')
        : status === 'saved'
          ? t('account.saved')
          : status === 'error'
            ? t('account.saveError')
            : ''}
    </p>
  )
}
