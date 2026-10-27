'use client'

import { useState } from 'react'
import { setTenantActive, setTenantTier } from '../../actions'
import { toastError } from '@/lib/toast'
import { useTranslation } from '@/lib/i18n/client'
import { TIER_ORDER, featuresForTier, type Tier } from '@/lib/tiers/features'
import { TenantSmsSenderSection } from './tenant-sms-sender-section'

interface Props {
  tenantId: string
  isActive: boolean
  tier: Tier
  smsSenderId: string | null
}

export function TenantDetail({
  tenantId,
  isActive: initialActive,
  tier: initialTier,
  smsSenderId,
}: Props) {
  const { t } = useTranslation('admin')
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
    <div className="divide-y divide-edge-soft">
      {/* Activation */}
      <div className="p-6">
        <h2 className="section-label mb-4">{t('systemAdmin.activation')}</h2>
        <div className="flex items-center gap-4">
          <button
            role="switch"
            aria-checked={isActive}
            onClick={handleToggleActive}
            disabled={pendingActive}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:opacity-50 ${
              isActive ? 'bg-ink' : 'bg-edge'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm font-semibold text-ink">
            {isActive ? t('systemAdmin.active') : t('systemAdmin.inactive')}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink-label">
          {isActive ? t('systemAdmin.tenantCanAccess') : t('systemAdmin.tenantCannotAccess')}
        </p>
      </div>

      {/* Feature tier */}
      <div className="p-6">
        <h2 className="section-label mb-4">{t('systemAdmin.featureTier')}</h2>
        <div className="flex flex-col gap-3">
          {TIER_ORDER.map((tierOption) => (
            <label key={tierOption} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="tier"
                value={tierOption}
                checked={tier === tierOption}
                onChange={() => handleTierChange(tierOption)}
                disabled={pendingTier}
                className="mt-0.5 size-4 border-edge-field text-ink accent-ink focus:ring-ink"
              />
              <span>
                <span className="block text-sm text-ink">{t(`systemAdmin.${tierOption}`)}</span>
                {/* Generated from TIER_FEATURES rather than written out per
                    tier, so the list cannot claim something the gate does not
                    actually grant. A tier with nothing tier-specific says so
                    instead of rendering an empty "Includes:". */}
                <span className="mt-0.5 block text-xs text-ink-label">
                  {featuresForTier(tierOption).length === 0
                    ? t('systemAdmin.tierIncludesNothing')
                    : `${t('systemAdmin.tierIncludes')} ${featuresForTier(tierOption)
                        .map((feature) =>
                          t(
                            `systemAdmin.feature${feature.charAt(0).toUpperCase()}${feature.slice(1)}`
                          )
                        )
                        .join(', ')}`}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-label">{t('systemAdmin.tierHint')}</p>
      </div>

      {/* N13: under the tier, which decides whether the name is used. Takes
          the live tier state so its hint follows a tier change made here. */}
      <TenantSmsSenderSection tenantId={tenantId} tier={tier} smsSenderId={smsSenderId} />
    </div>
  )
}
