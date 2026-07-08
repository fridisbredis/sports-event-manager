'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { createTenant } from '../actions'
import { toSlug } from '../_utils'

interface Props {
  open: boolean
  onClose: () => void
}

function Modal({ open, onClose }: Props) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const slug = toSlug(name)

  async function handleSubmit() {
    if (!name.trim() || pending) return
    setPending(true)
    setError(null)
    const result = await createTenant(name)
    setPending(false)
    if (result.error) {
      setError(result.error)
    } else {
      setName('')
      onClose()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create tenant</h2>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Race name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          {slug && (
            <p className="mt-1.5 text-xs text-gray-400">
              URL slug: <span className="font-mono text-gray-500">{slug}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            This provisions an empty event draft for the tenant.
          </p>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim() || pending}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreateTenantModal({ open, onClose }: Props) {
  if (typeof document === 'undefined') return null
  return createPortal(<Modal open={open} onClose={onClose} />, document.body)
}
