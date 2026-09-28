'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LogOut } from 'lucide-react'
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

interface AccountFormProps {
  name: string
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
      {/* Mobile bottom padding clears both the tab bar (64px) and the fixed
          Save bar that sits on top of it (~60px with its padding) — pb-24
          was sized before the log-out button existed and left it partly
          underneath. */}
      <div className={isDesktop ? 'max-w-lg' : 'px-5 pt-10 pb-40'}>
        {/* Avatar */}
        <div className="flex justify-center mb-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-status-neutral-bg">
            <span className="text-2xl font-semibold text-ink-soft">
              {name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </div>
        </div>

        {/* Name field */}
        <div className="mb-5">
          <Input
            label={t('account.nameLabel')}
            value={name}
            onValueChange={handleNameChange}
            description={t('account.editHint')}
            labelPlacement="outside"
          />
        </div>

        {/* Phone field */}
        <div className="mb-8">
          <label className="mb-1.5 block text-sm text-ink-soft">{t('account.phoneLabel')}</label>
          <div className="w-full select-none rounded-control border-1 border-edge bg-white px-3.5 py-2.5 text-[15px] text-ink-muted">
            {formatPhoneForDisplay(phone)}
          </div>
        </div>

        {/* Notifications section */}
        <p className="section-label mb-3">{t('account.notificationsHeading')}</p>
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

        {/* Schedule section — admin only. An official already has My schedule
            in the bottom tab bar, so the same link here is a second door to
            one room; an admin's sidebar has no equivalent. */}
        {isDesktop && assignmentCount > 0 && (
          <>
            <p className="section-label mb-3">{t('account.scheduleHeading')}</p>
            <Link
              href={`/${tenantSlug}/schedule`}
              className={`flex items-center gap-4 ${CARD_SURFACE} mb-8 px-4 py-4 transition-colors hover:bg-surface`}
            >
              {/* A calendar, since the row leads to the schedule — the
                  empty square it replaced read as an unchecked checkbox. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                className="h-8 w-8 shrink-0 text-tenant-primary"
              >
                <rect x="3" y="5" width="18" height="16" rx="2.5" />
                <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-ink">
                  {t('account.assignmentCount', { count: assignmentCount })}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">{t('account.viewSchedule')}</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="h-5 w-5 shrink-0 text-ink-label"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
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
