import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import twilio from 'twilio'
import { z } from 'zod'

const inviteSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  phone: z.string().min(8),
})

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = inviteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name, phone } = parsed.data

  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) return auth.error

  const service = await createSupabaseServiceClient()

  const { data: official, error } = await service
    .from('officials')
    .insert({ tenant_id: tenantId, name, phone, invite_status: 'pending' })
    .select()
    .single()

  if (error || !official) {
    return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
  }

  const { data: tenant } = await service.from('tenants').select('name').eq('id', tenantId).single()

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  await client.messages.create({
    body: `Hi ${name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Reply to this message or follow the link to accept: ${process.env.NEXT_PUBLIC_APP_URL}/login`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  })

  return NextResponse.json({ official })
}
