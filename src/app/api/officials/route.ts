import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { normalizePhoneToE164, PHONE_COUNTRIES, stripE164Plus, toTwilioE164 } from '@/lib/phone'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import { adminDashboardCacheTag } from '@/lib/cache/tags'
import type { AuditActorRole } from '@/types/app'
import twilio from 'twilio'
import { z } from 'zod'
import {
  checkInviteRateLimit,
  releaseInviteRateLimit,
  type RateLimitResult,
} from '@/lib/rate-limit'
import { logQueryError } from '@/lib/db/query-error'

const PHONE_COUNTRY_CODES = PHONE_COUNTRIES.map((c) => c.code)

const inviteSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  phone: z.string().min(1),
  phoneCountry: z.enum(PHONE_COUNTRY_CODES as [string, ...string[]]),
})

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = inviteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, name, phoneCountry } = parsed.data
  const phone = normalizePhoneToE164(
    parsed.data.phone,
    phoneCountry as (typeof PHONE_COUNTRY_CODES)[number]
  )
  if (!phone) {
    return NextResponse.json(
      { error: 'Invalid phone number for the selected country', code: 'invalid_phone' },
      { status: 400 }
    )
  }

  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) return auth.error

  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkInviteRateLimit(tenantId, stripE164Plus(phone), auth.user.id)
  } catch (err) {
    // Log the tenant id and the underlying DB error message only — never the raw
    // phone number, which the rate limit keys embed.
    //
    // One pre-formatted string, and never an undefined argument: console patching by
    // editor extensions can throw on those, and a throw here would escape this catch
    // and turn a handled rate-limit failure back into an unhandled 500.
    const cause =
      err instanceof Error ? (err.cause as { message?: unknown } | undefined)?.message : undefined
    try {
      logger.error('Invite rate limit check failed', undefined, {
        tenantId,
        cause: cause ?? 'unknown',
      })
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

  const supabase = await createSupabaseServerClient()

  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Officials in one tenant may share a name but not a phone number — the phone is
  // what invite confirmation binds against (0017/0018). Checked here as well as by the
  // partial unique index from 0020 so the rule still holds if a database is behind on
  // migrations; the index is what makes it race-proof, handled below.
  const { data: duplicate, error: duplicateError } = await supabase
    .from('officials')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .neq('invite_status', 'removed')
    .limit(1)
    .maybeSingle()

  // A failed check is not "no duplicate", but it must not fail the invite
  // either: the partial unique index from 0020 is the race-proof guarantee and
  // still turns a real duplicate into the 409 below. So log and continue —
  // this read going dark would otherwise be invisible until the index started
  // catching everything.
  if (duplicateError) {
    logQueryError(duplicateError, {
      op: 'POST /api/officials',
      table: 'officials',
      kind: 'select',
      tenantId,
      extra: { check: 'duplicate_phone_precheck' },
    })
  }

  if (duplicate) {
    await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
    return NextResponse.json(
      { error: 'An official with this phone number already exists', code: 'duplicate_phone' },
      { status: 409 }
    )
  }

  // auth.admin.* has no RLS-based equivalent — stays on the service client
  // (row #15 in docs/security/service-role-audit.md).
  const service = createSupabaseServiceClient()

  // The auth.users row is created here, at invite time, rather than lazily via
  // signInWithOtp's default shouldCreateUser:true when the invitee later logs in.
  // That lets "Allow new users to sign up" stay disabled in Supabase Auth settings —
  // otherwise any phone number could self-register just by requesting an OTP.
  const { data: created, error: createUserError } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
  })

  let officialUserId: string
  if (createUserError) {
    // phone_exists: the number already has an auth.users row (e.g. official at another
    // tenant, or a tenant admin). Reuse that account rather than failing the invite.
    if (createUserError.code === 'phone_exists') {
      const { data: existingUserId, error: lookupError } = await service.rpc(
        'get_user_id_by_phone',
        { p_phone: phone }
      )
      if (lookupError || !existingUserId) {
        logQueryError(lookupError, {
          op: 'POST /api/officials',
          table: 'get_user_id_by_phone',
          kind: 'rpc',
          tenantId,
          // phone_exists said the auth row is there, so an empty result is a
          // real inconsistency rather than an ordinary miss.
          extra: { reason: lookupError ? 'rpc_error' : 'no_user_for_existing_phone' },
        })
        await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
        return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
      }
      officialUserId = existingUserId
    } else {
      logQueryError(createUserError, {
        op: 'POST /api/officials',
        table: 'auth.users',
        kind: 'insert',
        tenantId,
      })
      await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
      return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
    }
  } else {
    officialUserId = created.user.id
  }

  const { data: official, error } = await supabase
    .from('officials')
    .insert({
      tenant_id: tenantId,
      user_id: officialUserId,
      name,
      phone,
      invite_status: 'invited',
      invite_token_expires_at: tokenExpiresAt,
    })
    .select()
    .single()

  // Two concurrent requests can both pass the check above; the unique index is the
  // real guarantee, so translate its violation into the same 409 rather than a 500.
  if (error?.code === '23505') {
    // Only clean up the auth user if we just created it — not if it was an existing
    // account we reused (phone_exists branch above), which must survive this request.
    if (!createUserError) await service.auth.admin.deleteUser(officialUserId)
    await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
    return NextResponse.json(
      { error: 'An official with this phone number already exists', code: 'duplicate_phone' },
      { status: 409 }
    )
  }

  if (error || !official) {
    // pgCode only, no message/details: this insert carries `phone`, and a
    // constraint violation on it quotes the value back in `details` — the same
    // reason the Twilio catch below logs the numeric code alone. The 23505 case
    // is already handled above, so anything reaching here is unexpected.
    logQueryError(
      { code: error?.code ?? 'none' },
      {
        op: 'POST /api/officials',
        table: 'officials',
        kind: 'insert',
        tenantId,
        extra: { reason: error ? 'insert_error' : 'no_row_returned' },
      }
    )
    if (!createUserError) await service.auth.admin.deleteUser(officialUserId)
    await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
    return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
  }

  await logAuditEvent({
    tenantId,
    actorUserId: auth.user.id,
    // requireTenantAdmin only ever returns 'system_admin' | 'tenant_admin',
    // though its type is the broader shared TenantRole.
    actorRole: auth.role as AuditActorRole,
    action: 'official_invited',
    targetType: 'official',
    targetId: official.id,
    detail: { phoneLast4: phone.slice(-4) },
  })

  // PERF-06 / F-PERF-04 Phase 3: the row is already committed at this point
  // (see the comment on the SMS try/catch below) — the dashboard's cached
  // invited-officials count is stale from here regardless of whether the SMS
  // send below succeeds. { expire: 0 } (immediate), not the docs' recommended
  // profile="max": updateTag isn't available — this is a Route Handler, not a
  // Server Action.
  revalidateTag(adminDashboardCacheTag(tenantId), { expire: 0 })

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single()

  // Cosmetic only — the SMS falls back to 'an event' — so this must not fail
  // the invite. Logged because a tenant row that cannot be read is a signal
  // even when the copy degrades gracefully.
  if (tenantError) {
    logQueryError(tenantError, {
      op: 'POST /api/officials',
      table: 'tenants',
      kind: 'select',
      tenantId,
      extra: { usage: 'invite_sms_copy' },
    })
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${official.invite_token}`

  // The row is already committed at this point. A failed send must not be reported as a
  // failed create, or the admin retries and we accumulate duplicate invited officials.
  // The row stays `invited`, which is exactly the state the resend endpoint accepts.
  //
  // The client is constructed inside the try on purpose: twilio() throws synchronously
  // when TWILIO_ACCOUNT_SID is set to a non-AC value, so building it outside would
  // escape this handler entirely and still surface as a 500.
  let smsSent = true
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    await client.messages.create({
      body: `Hi ${name}, you have been invited as an official for ${tenant?.name ?? 'an event'}. Confirm your availability here: ${inviteUrl}`,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: toTwilioE164(phone),
    })
  } catch (err) {
    smsSent = false
    await releaseInviteRateLimit(tenantId, stripE164Plus(phone))
    // Log the DB-generated id and Twilio's numeric code only — never the raw error,
    // which can echo the submitted phone number back into the logs.
    //
    // One pre-formatted string, and never an undefined argument: console patching by
    // editor extensions can throw on those, and a throw here would escape this catch
    // and turn a handled SMS failure back into a 500.
    const code = (err as { code?: unknown } | null)?.code
    try {
      logger.error('Invite SMS failed', undefined, {
        officialId: official.id,
        twilioCode: code ?? 'none',
      })
    } catch {
      // A throw here would escape the outer catch and turn a handled SMS failure back
      // into a 500. Editor extensions that patch console can throw; logging must never
      // be able to change the response.
    }
  }

  const {
    invite_token: _inviteToken,
    invite_token_expires_at: _inviteTokenExpiresAt,
    ...officialForClient
  } = official

  return NextResponse.json({ official: officialForClient, smsSent })
}
