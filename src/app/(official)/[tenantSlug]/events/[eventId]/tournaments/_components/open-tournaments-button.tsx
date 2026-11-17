'use client'

import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export function OpenTournamentsButton({ appUrl, tenantSlug, eventId }: Props) {
  const { t } = useTranslation('official')
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3">
      <Button
        color="primary"
        startContent={<Trophy className="size-4" aria-hidden="true" />}
        isLoading={opening}
        // onPress runs within the click, which openTournaments needs to open
        // the tab before it awaits the token.
        onPress={async () => {
          setProblem(null)
          setOpening(true)
          const result = await openTournaments(appUrl, tenantSlug, eventId)
          setOpening(false)
          if (result !== 'opened') setProblem(t(MESSAGES[result]))
        }}
      >
        {t('tournaments.open')}
      </Button>
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
