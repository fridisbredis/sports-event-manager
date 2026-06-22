import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { z } from 'zod'

const inviteSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  phone: z.string().min(8),
})

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const json = await request.json()
  const parsed = inviteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name, phone } = parsed.data

  // TODO: verify user is tenant admin for this tenantId

  const service = await createSupabaseServiceClient()

  // Create official record
  const { data: official, error } = await service
    .from('officials')
    .insert({ tenant_id: tenantId, name, phone, invite_status: 'pending' })
    .select()
    .single()

  if (error || !official) {
    return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
  }

  // Fetch tenant name for the invite message
  const { data: tenant } = await service
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single()

  // Send SMS invite
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  await client.messages.create({
    body: `Hi ${name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Reply to this message or follow the link to accept: ${process.env.NEXT_PUBLIC_APP_URL}/login`,
    from: process.env.TWILIO_PHONE_NUMBER!,
    to: phone,
  })

  return NextResponse.json({ official })
}
