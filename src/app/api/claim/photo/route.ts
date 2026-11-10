import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { loadClaimTarget } from '@/lib/participants/claim-target'
import {
  ALLOWED_PARTICIPANT_AVATAR_TYPES,
  MAX_PARTICIPANT_AVATAR_BYTES,
  saveParticipantAvatar,
} from '@/lib/participants/participant-avatar'

// N40 (L8): the optional photo, uploaded right after Complete. A separate
// request because the claim must not wait on, or fail with, an image upload:
// the runner is signed in and claimed whether or not this succeeds, and can
// add the photo later on My account.
//
// The row must already be the caller's — participants.user_id is the
// verified session's user — which is what makes the service-role write safe
// (see participant-avatar.ts for why there is no self-update policy).

const fieldsSchema = z.object({
  token: z.string().uuid(),
  participantId: z.string().uuid(),
})

const OP = 'POST /api/claim/photo'

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const parsed = fieldsSchema.safeParse({
    token: form?.get('token'),
    participantId: form?.get('participantId'),
  })
  const file = form?.get('file')
  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!ALLOWED_PARTICIPANT_AVATAR_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported type', code: 'type' }, { status: 400 })
  }
  if (file.size > MAX_PARTICIPANT_AVATAR_BYTES) {
    return NextResponse.json({ error: 'Too large', code: 'size' }, { status: 413 })
  }
  const { token, participantId } = parsed.data

  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, { op: OP, table: 'auth.users', kind: 'select' })
  }
  const user = auth.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createSupabaseServiceClient()
  const target = await loadClaimTarget(service, token, participantId, OP)
  if (target.kind !== 'open') {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  // Ownership, through the caller's own RLS read (participant_read_own): the
  // row is visible only if it is theirs. saveParticipantAvatar filters its
  // write on the same user_id as a second guard.
  const { data: own, error: ownError } = await supabase
    .from('participants')
    .select('id')
    .eq('id', participantId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (ownError) {
    logQueryError(ownError, { op: OP, table: 'participants', kind: 'select' })
  }
  if (!own) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  const avatarUrl = await saveParticipantAvatar(
    service,
    { tenantId: target.tenantId, participantId, userId: user.id },
    file,
    OP
  )
  if (!avatarUrl) {
    return NextResponse.json({ error: 'Upload failed', code: 'failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, avatarUrl })
}
