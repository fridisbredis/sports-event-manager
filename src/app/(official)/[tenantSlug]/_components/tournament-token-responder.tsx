'use client'

import { useEffect } from 'react'
import { answerTokenRequest } from '@/lib/tournament/open-tournaments'

// ADR-0005 §7: answers the tournament app's requests for a new token while
// this tab is open. In the official layout rather than on the tournaments
// page, so it keeps answering while the official moves on in Viadal.
export function TournamentTokenResponder({ appOrigin }: { appOrigin: string }) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      void answerTokenRequest(event, appOrigin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appOrigin])

  return null
}
