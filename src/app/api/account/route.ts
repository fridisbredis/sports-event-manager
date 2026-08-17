import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

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
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
