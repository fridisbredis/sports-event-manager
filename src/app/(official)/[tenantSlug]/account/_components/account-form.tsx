'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight, LogOut } from 'lucide-react'
import { Switch } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { LogoutButton } from '@/components/logout-button'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
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
  layout = 'mobile',
}: AccountFormProps) {
  const { t } = useTranslation(i18nNamespace)
  const { markDirty, markClean, dialogProps } = useUnsavedChanges()

  const [name, setName] = useState(initialName)
  const [smsOptOut, setSmsOptOut] = useState(initialSmsOptOut)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  function handleNameChange(value: string) {
    setName(value)
    markDirty()
    setSaveState('idle')
  }

  function handleToggle(isSelected: boolean) {
    setSmsOptOut(!isSelected)
    markDirty()
    setSaveState('idle')
  }

  async function handleSave() {
    setSaveState('saving')

    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name, smsOptOut }),
      })

      if (!res.ok) {
        throw new Error('Save failed')
      }

      markClean()
      setSaveState('saved')
    } catch {
      setSaveState('idle')
      toastError(t('account.saveError'))
    }
  }

  const saveLabel =
    saveState === 'saving'
      ? t('account.saving')
      : saveState === 'saved'
        ? t('account.saved')
        : t('account.save')

  const isDesktop = layout === 'desktop'

  return (
    <>
      {isDesktop && (
        <div className="flex items-center justify-between mb-8">
          <h1 className="page-title">{t('account.title')}</h1>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              color={saveState === 'saved' ? 'success' : 'primary'}
              isLoading={saveState === 'saving'}
              onPress={handleSave}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      )}
      {/* Mobile bottom padding clears the fixed Save bar so the log-out
          button never sits underneath it. The bar occupies ~128px: the tab
          bar it floats above (64px) plus its own mt-3, button and pb-2.
          pb-36 (144px) clears that with a modest gap; pb-40 left an
          obviously empty band below the last control. */}
      <div className={isDesktop ? 'max-w-lg' : 'px-5 pt-10 pb-36'}>
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
          />
        </div>

        {/* Phone field. Grey rather than white: it is the one field on the
            screen that cannot be typed in, and the flat grey says so before
            the "(read-only)" in the label has to. */}
        <div className="mb-8">
          <label className="mb-1.5 block text-sm text-ink-soft">{t('account.phoneLabel')}</label>
          <div className="w-full select-none rounded-control border-1 border-edge bg-surface px-3.5 py-2.5 text-[15px] text-ink-muted">
            {formatPhoneForDisplay(phone)}
          </div>
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

      {/* Mobile: Save button fixed at bottom above tab bar */}
      {!isDesktop && (
        <div className="fixed bottom-16 inset-x-0 px-5 pb-2 bg-white border-t border-gray-100">
          <Button
            type="button"
            color="primary"
            isLoading={saveState === 'saving'}
            onPress={handleSave}
            fullWidth
            className="mt-3 rounded-large py-3 text-sm font-semibold"
          >
            {saveLabel}
          </Button>
        </div>
      )}

      <UnsavedChangesDialog {...dialogProps} />
    </>
  )
}
