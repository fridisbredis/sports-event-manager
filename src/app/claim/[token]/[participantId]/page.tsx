import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { loadClaimTarget } from '@/lib/participants/claim-target'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

import ClaimForm from './_components/claim-form'
import ClaimStatusView from './_components/claim-status-view'

// CLAIM-02 (N40): claim and register with an SMS code. Public, like CLAIM-01
// above it (src/proxy.ts exempts /claim/): the runner has no account yet.
//
// loadClaimTarget is the access check. It resolves the event from the token
// and reads the participant by id AND that event, so a participant id from
// another event or tenant is a plain 404 — the same answer as an unknown id.

interface Props {
  params: Promise<{ token: string; participantId: string }>
}

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ClaimParticipantPage({ params }: Props) {
  const { token, participantId } = await params

  const result = await loadClaimTarget(createSupabaseServiceClient(), token, participantId)

  if (result.kind === 'not_found') notFound()

  const listHref = `/claim/${encodeURIComponent(token)}`

  if (result.kind === 'closed') {
    return (
      <>
        <TenantThemeStyle colorPalette={result.event.palette} />
        <ClaimStatusView event={result.event} listHref={listHref} />
      </>
    )
  }

  return (
    <>
      <TenantThemeStyle colorPalette={result.event.palette} />
      <ClaimForm
        token={token}
        event={{ name: result.event.name, logoUrl: result.event.logoUrl }}
        participant={{
          id: result.participant.id,
          bib: result.participant.bib,
          name: result.participant.name,
        }}
        listHref={listHref}
        // N42: someone already holds this row. The same form, ending as a
        // conflict for an admin to decide ("This is me"). Nothing about the
        // current claimant is read or shown. If it was the runner themself,
        // verifying their own number simply completes as before.
        conflict={result.participant.claimed}
      />
    </>
  )
}
