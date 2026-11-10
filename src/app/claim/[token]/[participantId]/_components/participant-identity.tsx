'use client'

import { useTranslation } from '@/lib/i18n/client'

// L14: the Race Results bib and name, read-only. Never an input — they belong
// to the import, and the account's own name lives elsewhere.
export function ParticipantIdentity({
  bib,
  name,
  showLabel = true,
}: {
  bib: string | null
  name: string | null
  /** Off once the claim is done: "You are claiming" no longer describes it. */
  showLabel?: boolean
}) {
  const { t } = useTranslation('auth')

  return (
    <div className="rounded-2xl border border-dashed border-edge px-4 py-3.5">
      {showLabel ? (
        <p className="mb-0.5 text-[12px] font-medium uppercase tracking-wide text-ink-label">
          {t('claim.participantLabel')}
        </p>
      ) : null}
      <p className="text-[17px] font-semibold text-ink">
        {[bib, name].filter(Boolean).join(' · ') || '–'}
      </p>
    </div>
  )
}
