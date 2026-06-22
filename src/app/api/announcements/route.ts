import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import twilio from 'twilio'
import { z } from 'zod'

const publishSchema = z.object({
  tenantId: z.string().uuid(),
  channel: z.enum(['officials', 'participants']),
  body: z.string().min(1).max(1600),
})

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Validate body
  const json = await request.json()
  const parsed = publishSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, channel, body } = parsed.data

  // TODO: verify user is tenant admin for this tenantId

  // Fetch phone numbers for the target channel
  const service = await createSupabaseServiceClient()
  const table = channel === 'officials' ? 'officials' : 'participants'
  const { data: recipients, error } = await service
    .from(table)
    .select('phone')
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
  }

  // Save announcement record
  await service.from('announcements').insert({
    tenant_id: tenantId,
    channel,
    body,
    sms_sent: false,
    published_at: new Date().toISOString(),
  })

  // Send SMS via Twilio
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  )

  const results = await Promise.allSettled(
    (recipients ?? []).map(({ phone }) =>
      client.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: phone,
      })
    )
  )

  const failed = results.filter(r => r.status === 'rejected').length

  // Mark SMS as sent
  // TODO: update the announcement record with sms_sent: true

  return NextResponse.json({
    sent: results.length - failed,
    failed,
  })
}
