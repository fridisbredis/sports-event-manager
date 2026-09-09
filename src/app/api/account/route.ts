import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { officialHomeCacheTag } from '@/lib/cache/tags'
import { z } from 'zod'
import { logQueryError } from '@/lib/db/query-error'

const officialSchema = z.object({
  mode: z.undefined().or(z.literal('official')),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  smsOptOut: z.boolean(),
})

const adminSchema = z.object({
  mode: z.literal('admin'),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
})

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await request.json()
  const service = await createSupabaseServiceClient()

  if (json.mode === 'admin') {
    const parsed = adminSchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { error } = await service.auth.admin.updateUserById(user.id, {
      user_metadata: { name: parsed.data.name },
    })

    if (error) {
      logQueryError(error, {
        op: 'PATCH /api/account',
        table: 'auth.users',
        kind: 'update',
      })
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  const parsed = officialSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name, smsOptOut } = parsed.data

  // invite_status must be filtered here, not just for row-count safety: without it an
  // UPDATE matching a re-invited official's old soft-deleted row writes the new name
  // and sms_opt_out into that dead row as well, and .single() then errors on the two
  // returned rows and reports a failure for an update that partly succeeded. Only a
  // confirmed row is editable, and there can be at most one per (user_id, tenant_id) —
  // user_id is set at confirm time, and confirmation requires the phone to match the
  // caller's verified auth phone, so one user cannot confirm two rows in one tenant.
  const { data: official, error } = await service
    .from('officials')
    .update({ name, sms_opt_out: smsOptOut })
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .eq('invite_status', 'confirmed')
    .select('id')
    .single()

  if (error || !official) {
    logQueryError(error, {
      op: 'PATCH /api/account',
      table: 'officials',
      kind: 'update',
      tenantId,
      // No error but no row means the filter matched nothing (not a confirmed
      // official in this tenant) rather than a query failure — worth telling
      // apart in Log Analytics, since only one of the two is a bug here.
      extra: { matchedNoRow: !error && !official },
    })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // PERF-06 / F-PERF-04 Phase 1: the `name` just written here is exactly what
  // HOME-01's cached read returns (migration 0050 — get_official_home_cached
  // selects officials.name, and home/page.tsx renders it as the greeting and
  // the avatar initials). Without this, an official renames themselves on
  // ACCT-01 and the home screen keeps greeting them by the old name for up to
  // the 60s revalidate window.
  //
  // Only the official branch needs it. The admin branch above writes
  // auth user_metadata, which no cached RPC reads.
  //
  // { expire: 0 }, not the docs' recommended profile="max": ACCT-01 is a
  // read-your-own-writes screen and "max" would serve the pre-rename value on
  // the very next /home load. updateTag isn't available — this is a Route
  // Handler, not a Server Action. Per ADR-0003, this clears only the replica
  // that served this request; the other 1-2 prod replicas expire on their own
  // 60s window.
  revalidateTag(officialHomeCacheTag(parsed.data.tenantId, user.id), { expire: 0 })

  return NextResponse.json({ ok: true })
}
