'use client'

import { Phone } from 'lucide-react'

import { useTranslation } from '@/lib/i18n/client'
import { isIceContactEmpty, type IceContact } from '@/lib/ice-contact'
import { formatPhoneForDisplay, toTwilioE164 } from '@/lib/phone'

/**
 * N37/N41: the ICE block of an expanded roster row — phone, name and relation
 * as key/value rows, or "No ICE contact given". Shared by OFF-01 (officials)
 * and PART-01 (participants), which show the same contact the same way.
 *
 * The phone is a tel: link so an admin on a phone taps it to call (L22, L27).
 * Built from the stored E.164 with its '+' restored, which is what a dialler
 * needs whatever country the number is in.
 *
 * Read only — the contact is its owner's to edit, on ACCT-01.
 */
export function IceContactSection({ ice }: { ice: IceContact | null }) {
  const { t } = useTranslation('admin')
  const { t: tCommon } = useTranslation('common')

  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
        {t('officials.detailIce')}
      </h3>
      {isIceContactEmpty(ice) || !ice ? (
        <p className="text-[14px] text-ink-soft">{t('officials.detailNoIce')}</p>
      ) : (
        <dl className="space-y-1.5 text-[14px]">
          {ice.phone && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-ink-soft">{tCommon('iceContact.phoneLabel')}</dt>
              <dd>
                <a
                  href={`tel:${toTwilioE164(ice.phone)}`}
                  aria-label={t('officials.detailIceCall', {
                    name: ice.name ?? formatPhoneForDisplay(ice.phone),
                  })}
                  className="inline-flex items-center gap-1.5 font-medium text-tenant-primary underline-offset-2 hover:underline"
                >
                  <Phone className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span className="tabular-nums">{formatPhoneForDisplay(ice.phone)}</span>
                </a>
              </dd>
            </div>
          )}
          {ice.name && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-ink-soft">{tCommon('iceContact.nameLabel')}</dt>
              <dd className="text-ink">{ice.name}</dd>
            </div>
          )}
          {ice.relation && (
            <div className="flex gap-3">
              <dt className="w-20 shrink-0 text-ink-soft">{tCommon('iceContact.relationLabel')}</dt>
              <dd className="text-ink">{ice.relation}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}
