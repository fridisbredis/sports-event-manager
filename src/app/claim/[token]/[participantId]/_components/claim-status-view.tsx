'use client'

import Link from 'next/link'
import { CircleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'

import { ParticipantIdentity } from './participant-identity'

interface Props {
  event: { name: string }
  participant?: { bib: string | null; name: string | null }
  status: 'closed' | 'claimed'
  listHref: string
}

// CLAIM-02's two dead ends: the event is not open (draft, unpublished, below
// Premium), or the row is already claimed. Neither sends a code.
export default function ClaimStatusView({ event, participant, status, listHref }: Props) {
  const { t } = useTranslation('auth')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-10">
      <p className="text-center text-[13px] font-medium text-ink-label">{event.name}</p>
      <h1 className="mt-1 text-center text-[22px] font-bold leading-snug text-ink">
        {t('claim.title')}
      </h1>

      {participant ? (
        <div className="mt-6">
          <ParticipantIdentity bib={participant.bib} name={participant.name} />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <CircleAlert className="size-12 text-ink-label" strokeWidth={1.5} aria-hidden="true" />
        {status === 'closed' ? (
          <p className="text-[15px] text-ink-soft">{t('claimList.notAvailable')}</p>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-ink">{t('claim.alreadyClaimedTitle')}</p>
            <p className="max-w-xs text-[15px] leading-relaxed text-ink-soft">
              {t('claim.alreadyClaimedBody')}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {status === 'claimed' ? (
          <Button as={Link} href="/login" color="primary" size="lg" fullWidth>
            {t('claim.signIn')}
          </Button>
        ) : null}
        <Button as={Link} href={listHref} variant="light" size="lg" fullWidth>
          {t('claim.backToList')}
        </Button>
      </div>
    </main>
  )
}
