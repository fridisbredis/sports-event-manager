'use client'

import { Input } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { ICE_NAME_MAX, ICE_RELATION_MAX, type IceContactInput } from '@/lib/ice-contact'

interface IceContactFieldsProps {
  value: IceContactInput
  onChange: (next: IceContactInput) => void
  /** Fired when focus leaves any of the three fields — ACCT-01 saves here. */
  onBlur?: () => void
  /** Shown under the phone field; set by the parent after validating. */
  phoneError?: string | null
  /** Distinguishes the field ids when the component is mounted twice. */
  idPrefix?: string
}

/**
 * N37: the three optional ICE fields — phone, then name and relation side by
 * side — with the "only the organisers can see this" note under them (R5c),
 * laid out as in the CLAIM-02 and ACCT-01 wireframes.
 *
 * Controlled and save-agnostic on purpose: ACCT-01 autosaves on blur, the
 * invite form sends the values along with its confirm call, and CLAIM-02
 * (N40) will submit them with its Complete button. Each parent decides when
 * to write; this only renders and reports.
 *
 * No visible labels, matching the wireframes: the placeholder names each
 * field, and the aria-label carries the same name for assistive tech once the
 * placeholder is gone. The parent renders the section heading, since the
 * three screens style it differently.
 */
export function IceContactFields({
  value,
  onChange,
  onBlur,
  phoneError = null,
  idPrefix = 'ice',
}: IceContactFieldsProps) {
  const { t } = useTranslation('common')

  function set<K extends keyof IceContactInput>(key: K, next: string) {
    onChange({ ...value, [key]: next })
  }

  return (
    <fieldset aria-describedby={`${idPrefix}-note`}>
      <legend className="sr-only">{t('iceContact.groupLabel')}</legend>
      <div className="space-y-3">
        <Input
          id={`${idPrefix}-phone`}
          type="tel"
          inputMode="tel"
          // Not "tel": the browser would offer the user's OWN number, which
          // is exactly the wrong value for this field.
          autoComplete="off"
          aria-label={t('iceContact.phoneLabel')}
          placeholder={t('iceContact.phoneLabel')}
          value={value.phone}
          onValueChange={(next) => set('phone', next)}
          onBlur={onBlur}
          maxLength={32}
          isInvalid={!!phoneError}
          errorMessage={phoneError ?? undefined}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            id={`${idPrefix}-name`}
            autoComplete="off"
            aria-label={t('iceContact.nameLabel')}
            placeholder={t('iceContact.nameLabel')}
            value={value.name}
            onValueChange={(next) => set('name', next)}
            onBlur={onBlur}
            maxLength={ICE_NAME_MAX}
          />
          <Input
            id={`${idPrefix}-relation`}
            autoComplete="off"
            aria-label={t('iceContact.relationLabel')}
            placeholder={t('iceContact.relationLabel')}
            value={value.relation}
            onValueChange={(next) => set('relation', next)}
            onBlur={onBlur}
            maxLength={ICE_RELATION_MAX}
          />
        </div>
      </div>
      <p id={`${idPrefix}-note`} className="mt-2 text-xs text-gray-400">
        {t('iceContact.visibilityNote')}
      </p>
    </fieldset>
  )
}
