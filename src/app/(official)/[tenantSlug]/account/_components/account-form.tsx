'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from '@/lib/i18n/client'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'

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
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(value: string) {
    setName(value)
    markDirty()
    setSaveState('idle')
  }

  function handleToggle(checked: boolean) {
    setSmsOptOut(!checked)
    markDirty()
    setSaveState('idle')
  }

  async function handleSave() {
    setSaveState('saving')
    setError(null)

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
      setError('Something went wrong. Please try again.')
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
            {error && <span className="text-sm text-red-500">{error}</span>}
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
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
            {t('account.nameLabel')}
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="flex-1 text-sm text-gray-900 bg-transparent outline-none"
            />
            <span className="text-xs font-medium text-gray-400 shrink-0">{t('account.editHint')}</span>
          </div>
        </div>

        {/* Phone field */}
        <div className="mb-8">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
            {t('account.phoneLabel')}
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex-1 text-sm text-gray-500">{phone}</span>
            <span className="text-xs font-medium text-gray-400 shrink-0">{t('account.readOnlyHint')}</span>
          </div>
        </div>

        {/* Notifications section */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('account.notificationsHeading')}
        </p>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 mb-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{t('account.smsUpdatesLabel')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t('account.smsUpdatesHint')}</p>
            </div>
            {/* Toggle: checked = SMS ON (smsOptOut = false) */}
            <button
              type="button"
              role="switch"
              aria-checked={!smsOptOut}
              onClick={() => handleToggle(smsOptOut)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 ${
                !smsOptOut ? 'bg-gray-900' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  !smsOptOut ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Schedule section — conditional */}
        {assignmentCount > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
              {t('account.scheduleHeading')}
            </p>
            <Link
              href={`/${tenantSlug}/schedule`}
              className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-4 mb-8 hover:bg-gray-50 transition-colors"
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

        {!isDesktop && error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      </div>

      {/* Mobile: Save button fixed at bottom above tab bar */}
      {!isDesktop && (
        <div className="fixed bottom-16 inset-x-0 px-5 pb-2 bg-white border-t border-gray-100">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors mt-3"
          >
            {saveLabel}
          </button>
        </div>
      )}

      <UnsavedChangesDialog {...dialogProps} />
    </>
  )
}
