import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { locales } from '@/lib/i18n/config'

// Mirrors the CHECK constraint on user_preferences.language (migration
// 20261001102501) — both derive from the same `locales` list, so adding a
// locale to config.ts and the constraint keeps this in step automatically.
const schema = z.object({
  language: z.enum(locales),
})

// Separate from PATCH /api/account on purpose. That handler is tenant-scoped:
// it takes a tenantId and writes the caller's officials row. Language is not
// tenant-scoped — a user has one language across every tenant they belong to —
// and the users who most need this endpoint (a global system_admin, an admin
// with no roster row) have no officials row for that handler to match.
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // Same split as PATCH /api/account: an expired session is the ordinary route
  // to the 401 below and is not logged, but a 5xx from GoTrue would otherwise
  // be indistinguishable from it.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'PATCH /api/account/language',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const service = await createSupabaseServiceClient()

  // Upsert rather than insert-or-update: the row is created on the user's
  // first ever choice and overwritten on every one after, and user_id is the
  // primary key, so one statement covers both. updated_at is set explicitly
  // because the column default only applies on insert.
  const { error } = await service.from('user_preferences').upsert(
    {
      user_id: user.id,
      language: parsed.data.language,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (error) {
    logQueryError(error, {
      op: 'PATCH /api/account/language',
      table: 'user_preferences',
      kind: 'update',
    })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // No revalidateTag here. Language is read with getUserLanguage() on every
  // render rather than from a cached RPC, and the client reloads the route
  // after a successful save so the server components re-render in the new
  // language. The cached official-home/dashboard payloads hold data, not
  // translated strings, so they stay valid across a language change.
  return NextResponse.json({ ok: true })
}
