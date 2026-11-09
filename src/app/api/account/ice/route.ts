import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { iceContactInputSchema, isIceContactEmpty, normalizeIceContact } from '@/lib/ice-contact'

// N37: saves the caller's own ICE contact from ACCT-01.
//
// Not tenant-scoped, for the same reason as /api/account/language: the contact
// belongs to the person, and every tenant they are in reads the same row.
//
// Runs on the RLS client, not service_role (SEC-03): user_ice_contacts'
// policies already say "a user manages exactly their own row", so the
// database enforces ownership and this handler only has to authenticate.
export async function PUT(request: NextRequest) {
  const op = 'PUT /api/account/ice'
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // Same split as /api/account/language: an expired session is the ordinary
  // route to 401 and is not logged, a GoTrue 5xx is.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, { op, table: 'auth.users', kind: 'select' })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = iceContactInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid ICE contact' }, { status: 400 })
  }

  const normalized = normalizeIceContact(parsed.data)
  if (!normalized.ok) {
    return NextResponse.json(
      { error: 'Invalid phone number', code: normalized.error },
      { status: 400 }
    )
  }

  // Clearing every field removes the row rather than keeping one full of
  // nulls: "no ICE contact" then has exactly one representation, and nothing
  // about a third person is stored once the user has taken it away.
  if (isIceContactEmpty(normalized.contact)) {
    const { error } = await supabase.from('user_ice_contacts').delete().eq('user_id', user.id)
    if (error) {
      logQueryError(error, { op, table: 'user_ice_contacts', kind: 'delete' })
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, contact: null })
  }

  // user_id is the primary key, so one upsert covers the first save and every
  // one after. updated_at is set here because the default only applies on
  // insert.
  const { error } = await supabase.from('user_ice_contacts').upsert(
    {
      user_id: user.id,
      ...normalized.contact,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    logQueryError(error, { op, table: 'user_ice_contacts', kind: 'update' })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, contact: normalized.contact })
}
