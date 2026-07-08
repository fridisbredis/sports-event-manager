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

  const { data: official, error } = await service
    .from('officials')
    .update({ name, sms_opt_out: smsOptOut })
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .select('id')
    .single()

  if (error || !official) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
