import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { stripE164Plus, toTwilioE164 } from '@/lib/phone'
import twilio from 'twilio'
import { z } from 'zod'
import {
  checkInviteRateLimit,
  releaseInviteRateLimit,
  type RateLimitResult,
} from '@/lib/rate-limit'

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

  const supabase = await createSupabaseServerClient()

  const { data: official } = await supabase
    .from('officials')
    .select('id, name, phone, invite_status')
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
    .single()

  if (!official) {
    return NextResponse.json({ error: 'Official not found' }, { status: 404 })
  }

  // Canonicalized once so it matches the key create used (route.ts) — the rate-limit
  // key is a plain string with no normalization of its own (see rate-limit.ts).
  const rateLimitPhone = stripE164Plus(official.phone)

  if (official.invite_status !== 'invited') {
    return NextResponse.json(
      { error: 'Can only resend invite to invited officials' },
      { status: 400 }
    )
  }

  // Both SMS configuration faults are checked here, before the token rotation below, and
  // both answer 500 rather than the 502 the send itself returns: a missing sender number
  // or a malformed TWILIO_ACCOUNT_SID is our own deployment being wrong, not Twilio
  // rejecting the message. The distinction is not cosmetic. 502 reads as transient and
  // invites the admin to retry, but these two faults are total and permanent, and every
  // retry rotates the invite token again - burning the official's still-valid link over
  // and over while no SMS can possibly go out. Failing here leaves the existing link
  // intact and tells the operator this needs escalation, not another click.
  const fromNumber = process.env.TWILIO_PHONE_NUMBER
  if (!fromNumber) {
    try {
      console.error('Invite SMS resend blocked: TWILIO_PHONE_NUMBER is not set')
    } catch {
      // Logging must never be able to change the response - see the send catch below.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  // twilio() throws synchronously when TWILIO_ACCOUNT_SID is unset or does not start with
  // 'AC'. It is constructed here, outside the send try, precisely so that throw can still
  // be told apart from a provider rejection instead of being folded into the 502.
  let client: ReturnType<typeof twilio>
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  } catch {
    // The caught error is never logged: the Twilio constructor quotes the offending
    // credential back in its own message.
    try {
      console.error('Invite SMS resend blocked: Twilio client could not be constructed')
    } catch {
      // Logging must never be able to change the response - see the send catch below.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkInviteRateLimit(parsed.data.tenantId, rateLimitPhone, auth.user.id)
  } catch (err) {
    // Log the DB-generated id and the underlying DB error message only — never the raw
    // phone number, which the rate limit keys embed.
    //
    // One pre-formatted string, and never an undefined argument: console patching by
    // editor extensions can throw on those, and a throw here would escape this catch
    // and turn a handled rate-limit failure back into an unhandled 500.
    const cause =
      err instanceof Error ? (err.cause as { message?: unknown } | undefined)?.message : undefined
    try {
      console.error(
        `Invite rate limit check failed for official ${official.id} (cause: ${cause ?? 'unknown'})`
      )
    } catch {
      // Logging must never be able to change the response - see the send catch below.
    }
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many invite attempts' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
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
  const { data: updated } = await supabase
    .from('officials')
    .update({ invite_token: randomUUID(), invite_token_expires_at: tokenExpiresAt })
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
    .select('invite_token')
    .single()

  if (!updated?.invite_token) {
    await releaseInviteRateLimit(parsed.data.tenantId, rateLimitPhone)
    return NextResponse.json({ error: 'Failed to refresh invite token' }, { status: 500 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', parsed.data.tenantId)
    .single()

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${updated.invite_token}`

  // The token above has already been regenerated and the old link revoked - that cannot
  // be rolled back here even if the send below fails, because the whole point of the
  // rotation is that the old token is gone. A failed send is therefore destructive rather
  // than a no-op: if the previous invite had been delivered and the official had not yet
  // clicked it, that working link is now dead and no replacement reached them, leaving the
  // official worse off than if the admin had never pressed resend at all. Returning an
  // error status (rather than a 200) is what surfaces the officials.resendError toast,
  // which is where that consequence is spelled out - resending is the only recovery, and
  // only once the send itself starts working.
  //
  // Only the send is inside this try. The client and the sender number were resolved
  // above, so nothing that reaches the catch below is a fault of our own configuration.
  try {
    await client.messages.create({
      body: `Hi ${official.name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Confirm your availability here: ${inviteUrl}`,
      from: fromNumber,
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
    // status instead of the create route's 200-with-flag. 502 is accurate here and only
    // here: everything still reaching this catch is a rejection from Twilio, because the
    // two configuration faults that used to land in it - a non-AC account SID and an
    // unset sender number - are now answered with a 500 before the token is touched.
    await releaseInviteRateLimit(parsed.data.tenantId, rateLimitPhone)
    return NextResponse.json({ error: 'Failed to send invite SMS' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
