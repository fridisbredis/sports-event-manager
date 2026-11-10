'use client'

import Link from 'next/link'
import { CircleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  event: { name: string }
  listHref: string
}

// CLAIM-02's dead end: the event is not open (draft, unpublished, below
// Premium). No code is sent. An already claimed row is not a dead end — it is
// the conflict path (N42), handled by ClaimForm.
export default function ClaimStatusView({ event, listHref }: Props) {
  const { t } = useTranslation('auth')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-8 pt-10">
      <p className="text-center text-[13px] font-medium text-ink-label">{event.name}</p>
      <h1 className="mt-1 text-center text-[22px] font-bold leading-snug text-ink">
        {t('claim.title')}
      </h1>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <CircleAlert className="size-12 text-ink-label" strokeWidth={1.5} aria-hidden="true" />
        <p className="text-[15px] text-ink-soft">{t('claimList.notAvailable')}</p>
      </div>

      <Button as={Link} href={listHref} variant="light" size="lg" fullWidth>
        {t('claim.backToList')}
      </Button>
    </main>
  )
}
