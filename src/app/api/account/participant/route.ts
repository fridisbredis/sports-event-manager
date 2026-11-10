import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'

const schema = z.object({
  tenantId: z.string().uuid(),
  smsOptOut: z.boolean(),
})

// N43: ACCT-01's SMS switch for a participant. A route of its own rather than
// a third mode on PATCH /api/account: that route writes an officials row (or,
// for admins, auth metadata), and a participant has neither.
//
// The write goes through set_own_participant_sms_opt_out with the caller's own
// session, so auth.uid() — not a body field — decides whose records change.
// The function touches sms_opt_out only.
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // A missing session is the ordinary path to the 401 and is not logged; an
  // Auth outage (5xx) would otherwise look exactly like it.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'PATCH /api/account/participant',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data: changed, error } = await supabase.rpc('set_own_participant_sms_opt_out', {
    p_tenant_id: parsed.data.tenantId,
    p_opt_out: parsed.data.smsOptOut,
  })

  if (error) {
    logQueryError(error, {
      op: 'PATCH /api/account/participant',
      table: 'participants',
      kind: 'update',
    })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // No record in this tenant: the caller is not a participant here.
  if (!changed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
