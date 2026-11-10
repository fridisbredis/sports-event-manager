import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { loadClaimList } from '@/lib/participants/claim-list'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

import ClaimListView from './_components/claim-list-view'

// CLAIM-01 (N39): the open claim list. Public — reachable without signing in
// (src/proxy.ts) — and keyed by the event's claim_token, which never changes,
// so a printed QR code keeps working through draft, publish and unpublish.
//
// All access control lives in loadClaimList: it decides open/closed with the
// shared isParticipantSideOpen check and returns only bib, name and a claimed
// flag. This page only renders what it is given.

interface Props {
  params: Promise<{ token: string }>
}

// A start list is not something search engines should index, and the token
// is not something a referrer header should carry to a logo host.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ClaimListPage({ params }: Props) {
  const { token } = await params
  const service = createSupabaseServiceClient()

  const result = await loadClaimList(service, token)

  // An unknown token gets the app's plain 404, with no event name or theme:
  // a guessed link must not be able to tell "wrong token" apart from "an
  // event that is not open yet".
  if (result.kind === 'not_found') notFound()

  return (
    <>
      <TenantThemeStyle colorPalette={result.event.palette} />
      <ClaimListView
        token={token}
        event={{ name: result.event.name, logoUrl: result.event.logoUrl }}
        participants={result.kind === 'open' ? result.participants : null}
      />
    </>
  )
}
