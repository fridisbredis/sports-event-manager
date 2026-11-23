import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'

// Hides (PUT) or reopens (DELETE) the admin dashboard onboarding guide for one
// event, for the signed-in user (admin_guide_dismissals, migration
// 20261123120310).
//
// Not tenant-scoped, like /api/account/push-subscription: the row is a
// personal display choice, and the worst a user can do with someone else's
// event id is hide a guide they would never be shown.
//
// Runs on the RLS client, not service_role (SEC-03): the policies say "a user
// manages exactly their own rows", so the database enforces ownership and
// this handler only has to authenticate.

const schema = z.object({
  eventId: z.string().uuid(),
})

async function requireUser(op: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  // Same split as /api/account/language: an expired session is the ordinary
  // route to 401 and is not logged, a GoTrue 5xx is.
  if (error && error.status !== undefined && error.status >= 500) {
    logQueryError(error, { op, table: 'auth.users', kind: 'select' })
  }

  return { supabase, user: data.user }
}

export async function PUT(request: NextRequest) {
  const op = 'PUT /api/account/onboarding-guide'
  const { supabase, user } = await requireUser(op)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // ignoreDuplicates makes this ON CONFLICT DO NOTHING: hiding an already
  // hidden guide (a second tab, a double click) succeeds without a write, and
  // authenticated needs no UPDATE grant.
  const { error } = await supabase
    .from('admin_guide_dismissals')
    .upsert(
      { user_id: user.id, event_id: parsed.data.eventId },
      { onConflict: 'user_id,event_id', ignoreDuplicates: true }
    )

  if (error) {
    logQueryError(error, { op, table: 'admin_guide_dismissals', kind: 'insert' })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const op = 'DELETE /api/account/onboarding-guide'
  const { supabase, user } = await requireUser(op)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // The user_id filter is redundant with RLS and kept on purpose (defense in
  // depth), as in /api/account/push-subscription.
  const { error } = await supabase
    .from('admin_guide_dismissals')
    .delete()
    .eq('user_id', user.id)
    .eq('event_id', parsed.data.eventId)

  if (error) {
    logQueryError(error, { op, table: 'admin_guide_dismissals', kind: 'delete' })
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
