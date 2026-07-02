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

// Strip spaces/dashes so the phone stored matches Supabase's E.164 user.phone
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, '')
}

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = inviteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name } = parsed.data
  const phone = normalizePhone(parsed.data.phone)

  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) return auth.error

  const service = await createSupabaseServiceClient()

  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: official, error } = await service
    .from('officials')
    .insert({
      tenant_id: tenantId,
      name,
      phone,
      invite_status: 'invited',
      invite_token_expires_at: tokenExpiresAt,
    })
    .select()
    .single()

  if (error || !official) {
    return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
  }

  const { data: tenant } = await service.from('tenants').select('name').eq('id', tenantId).single()

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${official.invite_token}`

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    body: `Hi ${name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Confirm your availability here: ${inviteUrl}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  })

  return NextResponse.json({ official })
}
