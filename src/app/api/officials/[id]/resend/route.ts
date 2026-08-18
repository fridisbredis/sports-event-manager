import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { toTwilioE164 } from '@/lib/phone'
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
    return NextResponse.json(
      { error: 'Can only resend invite to invited officials' },
      { status: 400 }
    )
  }

  // Regenerate the token as well as the expiry, so the old link is genuinely revoked
  // rather than extended: resend is the only tool an admin has when a link has gone to
  // the wrong number or leaked, and reusing the token would hand that URL another seven
  // days instead of retiring it. Scoped to tenant_id as well as id — the id is a
  // server-side PK and the select above already verified the tenant, but every other
  // write in this codebase carries both, and a single unscoped filter is what an
  // audit has to stop and reason about.
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: updated } = await service
    .from('officials')
    .update({ invite_token: randomUUID(), invite_token_expires_at: tokenExpiresAt })
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
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

  // The token above has already been regenerated and the old link revoked - that cannot
  // be rolled back here even if the send below fails, because the whole point of the
  // rotation is that the old token is gone. The SMS body carries the new token, so the
  // only recovery available to the admin is to hit resend again, which is exactly what
  // returning an error status (rather than a 200) invites them to do.
  //
  // The client is constructed inside the try on purpose: twilio() throws synchronously
  // when TWILIO_ACCOUNT_SID is set to a non-AC value, so building it outside would
  // escape this handler entirely and still surface as a 500.
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    await client.messages.create({
      body: `Hi ${official.name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Confirm your availability here: ${inviteUrl}`,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: toTwilioE164(official.phone),
    })
  } catch (err) {
    // Log the DB-generated id and Twilio's numeric code only - never the raw error,
    // which can echo the submitted phone number back into the logs.
    //
    // One pre-formatted string, and never an undefined argument: console patching by
    // editor extensions can throw on those, and a throw here would escape this catch
    // and turn a handled SMS failure into an unhandled 500.
    const code = (err as { code?: unknown } | null)?.code
    try {
      console.error(
        `Invite SMS resend failed for official ${official.id} (twilio code: ${code ?? 'none'})`
      )
    } catch {
      // A throw here would escape the outer catch. Logging must never be able to
      // change the response.
    }

    // Unlike create, a failed resend carries no duplicate-row hazard: retrying just
    // regenerates the token again and tries the send again. So this returns an error
    // status instead of the create route's 200-with-flag, and 502 rather than the 500
    // above - this is an upstream provider rejection, not a fault in our own handler.
    return NextResponse.json({ error: 'Failed to send invite SMS' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
