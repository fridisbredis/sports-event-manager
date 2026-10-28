'use client'

import { useState } from 'react'
import { setTenantSmsSenderId } from '../../actions'
import { Input } from '@/components/ui/form-fields'
import { SystemButton } from '../../_components/system-button'
import { toastError, toastSuccess } from '@/lib/toast'
import { useTranslation } from '@/lib/i18n/client'
import { hasFeature, type Tier } from '@/lib/tiers/features'
import { SMS_SENDER_ID_MAX_LENGTH, smsSenderIdSchema } from '@/lib/sms/sender'

/**
 * N13: the tenant's alphanumeric SMS sender name, on the system-admin tenant
 * page.
 *
 * Rendered inside TenantDetail, under the tier radios, because the tier is
 * what decides whether the name is used: the hint below has to follow a tier
 * change made a moment ago on the same page, which TenantDetail's local tier
 * state carries and a server-rendered section would not.
 *
 * Editable only on Professional. Below it the field is not shown at all: an
 * editable box for a name that is not used read as if the name were in use.
 * A name saved before a downgrade stays on the row (resolveSmsSender gates on
 * read) and the section says so, since it comes back on an upgrade.
 */

interface Props {
  tenantId: string
  tier: Tier
  smsSenderId: string | null
}

export function TenantSmsSenderSection({ tenantId, tier, smsSenderId }: Props) {
  const { t } = useTranslation('admin')
  const [saved, setSaved] = useState(smsSenderId ?? '')
  const [value, setValue] = useState(smsSenderId ?? '')
  const [pending, setPending] = useState(false)

  const parsed = smsSenderIdSchema.safeParse(value)
  const dirty = value.trim() !== saved
  const unlocked = hasFeature(tier, 'smsSenderId')

  async function handleSave() {
    if (!parsed.success || !dirty || pending) return
    setPending(true)
    const result = await setTenantSmsSenderId(tenantId, value)
    if (result.error) {
      toastError(result.error)
    } else {
      const next = parsed.data ?? ''
      setSaved(next)
      setValue(next)
      toastSuccess(t('systemAdmin.smsSenderSaved'))
    }
    setPending(false)
  }

  if (!unlocked) {
    return (
      <div className="p-6">
        <h2 className="section-label mb-4">{t('systemAdmin.smsSenderTitle')}</h2>
        <p className="text-sm text-ink-label">{t('systemAdmin.smsSenderLockedHint')}</p>
        {saved && (
          <p className="mt-1 text-sm text-ink-label">
            {t('systemAdmin.smsSenderKeptHint', { name: saved })}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="p-6">
      <h2 className="section-label mb-4">{t('systemAdmin.smsSenderTitle')}</h2>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        <Input
          label={t('systemAdmin.smsSenderLabel')}
          className="w-full sm:max-w-xs"
          value={value}
          maxLength={SMS_SENDER_ID_MAX_LENGTH}
          onValueChange={setValue}
          isInvalid={!parsed.success}
          errorMessage={t('systemAdmin.smsSenderInvalid')}
        />
        <SystemButton
          onPress={handleSave}
          isDisabled={!parsed.success || !dirty}
          isLoading={pending}
          className="w-full sm:mt-2 sm:w-auto"
        >
          {t('systemAdmin.smsSenderSave')}
        </SystemButton>
      </div>

      <p className="mt-3 text-sm text-ink-label">{t('systemAdmin.smsSenderHint')}</p>
      {/* What actually happens to this tenant's messages right now. */}
      <p className="mt-1 text-sm text-ink-label">
        {saved
          ? t('systemAdmin.smsSenderActiveHint', { name: saved })
          : t('systemAdmin.smsSenderEmptyHint')}
      </p>
    </div>
  )
}
