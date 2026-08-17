'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, Switch } from '@heroui/react'
import { Input } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
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
          <h1 className="text-xl font-semibold text-gray-900">{t('account.title')}</h1>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="bordered"
              color={saveState === 'saved' ? 'success' : 'default'}
              isLoading={saveState === 'saving'}
              onPress={handleSave}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      )}
      <div className={isDesktop ? 'max-w-lg' : 'px-5 pt-10 pb-24'}>
        {/* Avatar */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-xl font-semibold text-gray-500">
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
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('account.phoneLabel')}
          </label>
          <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
            {formatPhoneForDisplay(phone)}
          </div>
        </div>

        {/* Notifications section */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('account.notificationsHeading')}
        </p>
        <AppCard className="mb-8" bodyClassName="px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{t('account.smsUpdatesLabel')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t('account.smsUpdatesHint')}</p>
            </div>
            {/* isSelected=true means SMS ON (smsOptOut=false) */}
            <Switch
              isSelected={!smsOptOut}
              onValueChange={handleToggle}
              aria-label={t('account.smsUpdatesLabel')}
            />
          </div>
        </AppCard>

        {/* Schedule section — conditional */}
        {assignmentCount > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              {t('account.scheduleHeading')}
            </p>
            <Link
              href={`/${tenantSlug}/schedule`}
              className={`flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 mb-8 hover:bg-gray-50 transition-colors`}
            >
              <div className="w-8 h-8 rounded-lg border-2 border-gray-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {t('account.assignmentCount', { count: assignmentCount })}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{t('account.viewSchedule')}</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-5 h-5 shrink-0 text-gray-400"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </>
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
