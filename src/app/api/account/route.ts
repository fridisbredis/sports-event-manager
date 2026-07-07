import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

const updateSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  smsOptOut: z.boolean(),
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
  const parsed = updateSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name, smsOptOut } = parsed.data

  const service = await createSupabaseServiceClient()

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
