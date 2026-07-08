'use client'

import { useState } from 'react'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'

interface AdminAccountFormProps {
  name: string
  phone: string
  tenantId: string
}

export default function AdminAccountForm({ name: initialName, phone, tenantId }: AdminAccountFormProps) {
  const { markDirty, markClean, dialogProps } = useUnsavedChanges()

  const [name, setName] = useState(initialName)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(value: string) {
    setName(value)
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
        body: JSON.stringify({ tenantId, name, mode: 'admin' }),
      })

      if (!res.ok) throw new Error('Save failed')

      markClean()
      setSaveState('saved')
    } catch {
      setSaveState('idle')
      setError('Något gick fel. Försök igen.')
    }
  }

  const saveLabel =
    saveState === 'saving' ? 'Sparar…' : saveState === 'saved' ? 'Sparat' : 'Spara'

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-xl font-semibold text-gray-900">Account</h1>
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

      <div className="max-w-lg">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-xl font-semibold text-gray-500">{initials || '?'}</span>
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
            Name (editable)
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="flex-1 text-sm text-gray-900 bg-transparent outline-none"
            />
            <span className="text-xs font-medium text-gray-400 shrink-0">Edit</span>
          </div>
        </div>

        <div className="mb-8">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1.5">
            Mobile number (read-only)
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <span className="flex-1 text-sm text-gray-500">
              {phone ? `+${phone}` : '—'}
            </span>
            <span className="text-xs font-medium text-gray-400 shrink-0">Read only</span>
          </div>
        </div>
      </div>

      <UnsavedChangesDialog {...dialogProps} />
    </>
  )
}
