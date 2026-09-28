'use client'

import { useState } from 'react'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { useTranslation } from '@/lib/i18n/client'

interface AdminAccountFormProps {
  name: string
  phone: string
  tenantId: string
}

export default function AdminAccountForm({
  name: initialName,
  phone,
  tenantId,
}: AdminAccountFormProps) {
  const { t } = useTranslation('admin')
  const { markDirty, markClean, dialogProps } = useUnsavedChanges()

  const [name, setName] = useState(initialName)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  function handleNameChange(value: string) {
    setName(value)
    markDirty()
    setSaveState('idle')
  }

  async function handleSave() {
    setSaveState('saving')

    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name, mode: 'admin' }),
      })

      if (!res.ok) throw new Error('Save failed')

      markClean()
      setSaveState('saved')
    } catch {
      setSaveState('idle')
      toastError(t('adminAccount.saveError'))
    }
  }

  const saveLabel =
    saveState === 'saving'
      ? t('adminAccount.saving')
      : saveState === 'saved'
        ? t('adminAccount.saved')
        : t('adminAccount.save')

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="page-title">{t('adminAccount.title')}</h1>
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

      <div className="max-w-lg">
        <AppCard>
          <div className="flex justify-center mb-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-status-neutral-bg">
              <span className="text-2xl font-semibold text-ink-soft">{initials || '?'}</span>
            </div>
          </div>

          <div className="mb-8">
            <Input
              label={t('adminAccount.nameLabel')}
              description={t('adminAccount.nameEditableHint')}
              value={name}
              onValueChange={handleNameChange}
              labelPlacement="outside"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-ink-soft">
              {t('adminAccount.mobileNumberLabel')}
            </label>
            <div className="w-full select-none rounded-control border-1 border-edge bg-white px-3.5 py-2.5 text-[15px] text-ink-muted">
              {phone ? formatPhoneForDisplay(phone) : '—'}
            </div>
          </div>
        </AppCard>
      </div>

      <UnsavedChangesDialog {...dialogProps} />
    </>
  )
}
