import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import twilio from 'twilio'
import { z } from 'zod'

const resendSchema = z.object({
  tenantId: z.string().uuid(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const json = await request.json()

  const parsed = resendSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const auth = await requireTenantAdmin(parsed.data.tenantId)
  if ('error' in auth) return auth.error

  const service = await createSupabaseServiceClient()

  const { data: official } = await service
    .from('officials')
    .select('id, name, phone, invite_status')
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
    .single()

  if (!official) {
    return NextResponse.json({ error: 'Official not found' }, { status: 404 })
  }

  if (official.invite_status !== 'invited') {
    return NextResponse.json({ error: 'Can only resend invite to invited officials' }, { status: 400 })
  }

  // Regenerate token + expiry to invalidate the old link
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: updated } = await service
    .from('officials')
    .update({ invite_token_expires_at: tokenExpiresAt })
    .eq('id', id)
    .select('invite_token')
    .single()

  if (!updated?.invite_token) {
    return NextResponse.json({ error: 'Failed to refresh invite token' }, { status: 500 })
  }

  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', parsed.data.tenantId)
    .single()

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${updated.invite_token}`

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    body: `Hi ${official.name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Confirm your availability here: ${inviteUrl}`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: official.phone,
  })

  return NextResponse.json({ ok: true })
}
