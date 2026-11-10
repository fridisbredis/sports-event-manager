import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { loadClaimTarget } from '@/lib/participants/claim-target'
import { loadClaimPrefill } from '@/lib/participants/claim-prefill'

// N40 (CLAIM-02): called right after the code is verified, when the session
// cookie exists. Tells the form whether this number already has an account
// in the tenant (existing-account: prefill photo, ICE, language) and whether
// it is already linked to another participant in this event
// (already-participant-in-event, L13: Complete stays disabled).

const schema = z.object({
  token: z.string().uuid(),
  participantId: z.string().uuid(),
})

const OP = 'POST /api/claim/prefill'

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { token, participantId } = parsed.data

  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, { op: OP, table: 'auth.users', kind: 'select' })
  }
  if (!auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const target = await loadClaimTarget(createSupabaseServiceClient(), token, participantId, OP)
  if (target.kind === 'not_found') {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }
  if (target.kind === 'closed') {
    return NextResponse.json({ error: 'Claiming is not open', code: 'not_open' }, { status: 403 })
  }

  const prefill = await loadClaimPrefill(supabase, {
    userId: auth.user.id,
    tenantId: target.tenantId,
    eventId: target.eventId,
    participantId,
    op: OP,
  })

  // Someone else's claim. Their details are not ours to show, so nothing of
  // the prefill is returned — the form shows the claimed message only.
  if (target.participant.claimed && !prefill.claimedByYou) {
    return NextResponse.json({ error: 'Already claimed', code: 'already_claimed' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, prefill })
}
