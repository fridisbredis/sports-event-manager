'use client'

import { useState } from 'react'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
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
        <h1 className="text-xl font-semibold text-gray-900">{t('adminAccount.title')}</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-40 transition-colors ${
              saveState === 'saved'
                ? 'border-green-200 bg-white text-green-600'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {saveLabel}
          </button>
        </div>
      </div>

      <div className="max-w-lg">
        <AppCard>
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
              <span className="text-xl font-semibold text-gray-500">{initials || '?'}</span>
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('adminAccount.mobileNumberLabel')}
            </label>
            <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
              {phone ? formatPhoneForDisplay(phone) : '—'}
            </div>
          </div>
        </AppCard>
      </div>

      <UnsavedChangesDialog {...dialogProps} />
    </>
  )
}
