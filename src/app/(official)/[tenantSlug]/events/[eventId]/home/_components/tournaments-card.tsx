'use client'

import { useState } from 'react'
import { ArrowUpRight, Loader2, Trophy } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { openTournaments, type OpenResult } from '@/lib/tournament/open-tournaments'

interface Props {
  appUrl: string
  tenantSlug: string
  eventId: string
}

const MESSAGES: Record<Exclude<OpenResult, 'opened'>, string> = {
  'popup-blocked': 'tournaments.popupBlocked',
  forbidden: 'tournaments.forbidden',
  unavailable: 'tournaments.unavailable',
}

/**
 * HOME-01's way into the tournament app (ADR-0005 §6.3). Opens the app
 * straight from the click instead of going through the tournaments page, so
 * the official is one tap from playing. A button, not a link: the app needs
 * a token first, and openTournaments must run inside the click to open the
 * tab before it awaits one.
 *
 * Deliberately unlike the nav cards above it: filled in the tenant colour
 * rather than white, and an outward arrow rather than a chevron, because it
 * leaves this app for another tab instead of moving within it.
 */
export function TournamentsCard({ appUrl, tenantSlug, eventId }: Props) {
  const { t } = useTranslation('official')
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function open() {
    setProblem(null)
    setOpening(true)
    const result = await openTournaments(appUrl, tenantSlug, eventId)
    setOpening(false)
    if (result !== 'opened') setProblem(t(MESSAGES[result]))
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={open}
        disabled={opening}
        aria-busy={opening}
        className="flex w-full items-center gap-4 rounded-large bg-tenant-primary px-4 py-4 text-left text-white shadow-card transition-colors hover:bg-tenant-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tenant-primary focus-visible:ring-offset-2 disabled:opacity-80"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-large bg-white/20">
          <Trophy className="size-6" strokeWidth={1.8} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold leading-snug">{t('home.tournaments')}</p>
          <p className="mt-0.5 text-[15px] leading-snug text-white/85">
            {t('home.tournamentsSub')}
          </p>
        </div>
        {opening ? (
          <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUpRight className="size-5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {problem ? (
        <p role="alert" className="px-1 text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
