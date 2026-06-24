import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import twilio from 'twilio'
import { z } from 'zod'

const publishSchema = z.object({
  tenantId: z.string().uuid(),
  channel: z.enum(['officials', 'participants']),
  body: z.string().min(1).max(1600),
})

export async function POST(request: NextRequest) {
  // Validate body first so we have tenantId for the auth check
  const json = await request.json()
  const parsed = publishSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, channel, body } = parsed.data

  // Auth + tenant authorization in one call
  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) return auth.error

  // ...rest of the handler unchanged (fetch recipients, insert announcement, send SMS)
  const service = await createSupabaseServiceClient()
  const table = channel === 'officials' ? 'officials' : 'participants'
  const { data: recipients, error } = await service
    .from(table)
    .select('phone')
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
  }

  await service.from('announcements').insert({
    tenant_id: tenantId,
    channel,
    body,
    sms_sent: false,
    published_at: new Date().toISOString(),
  })

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  const results = await Promise.allSettled(
    (recipients ?? []).map(({ phone }) =>
      client.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: phone,
      })
    )
  )

  const failed = results.filter((r) => r.status === 'rejected').length

  return NextResponse.json({
    sent: results.length - failed,
    failed,
  })
}
