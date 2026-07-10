'use client'

import { useState } from 'react'
import { setTenantActive, setTenantTier } from '../../actions'
import { toastError } from '@/lib/toast'

type Tier = 'standard' | 'premium' | 'professional'

interface Props {
  tenantId: string
  isActive: boolean
  tier: Tier
}

const TIERS: Tier[] = ['standard', 'premium', 'professional']

export function TenantDetail({ tenantId, isActive: initialActive, tier: initialTier }: Props) {
  const [isActive, setIsActive] = useState(initialActive)
  const [tier, setTier] = useState<Tier>(initialTier)
  const [pendingActive, setPendingActive] = useState(false)
  const [pendingTier, setPendingTier] = useState(false)

  async function handleToggleActive() {
    if (pendingActive) return
    setPendingActive(true)
    const next = !isActive
    const result = await setTenantActive(tenantId, next)
    if (result.error) {
      toastError(result.error)
    } else {
      setIsActive(next)
    }
    setPendingActive(false)
  }

  async function handleTierChange(next: Tier) {
    if (pendingTier || next === tier) return
    setPendingTier(true)
    const result = await setTenantTier(tenantId, next)
    if (result.error) {
      toastError(result.error)
    } else {
      setTier(next)
    }
    setPendingTier(false)
  }

  return (
    <div className="divide-y divide-gray-100">
      {/* Activation */}
      <div className="p-8">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Activation
        </h2>
        <div className="flex items-center gap-4">
          <button
            role="switch"
            aria-checked={isActive}
            onClick={handleToggleActive}
            disabled={pendingActive}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 disabled:opacity-50 ${
              isActive ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-gray-900">{isActive ? 'Active' : 'Inactive'}</span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {isActive
            ? 'The tenant can access its event workspace.'
            : 'The tenant cannot access its event workspace.'}
        </p>
      </div>

      {/* Feature tier */}
      <div className="p-8">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Feature tier
        </h2>
        <div className="flex flex-col gap-3">
          {TIERS.map((t) => (
            <label key={t} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="tier"
                value={t}
                checked={tier === t}
                onChange={() => handleTierChange(t)}
                disabled={pendingTier}
                className="h-4 w-4 text-gray-900 border-gray-300 focus:ring-gray-900"
              />
              <span className="text-sm text-gray-900 capitalize">{t}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-sm text-gray-500">
          Exactly one tier is active per tenant in v1. Selecting one clears the others.
        </p>
      </div>
    </div>
  )
}
