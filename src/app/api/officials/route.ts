import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { normalizePhoneToE164, PHONE_COUNTRIES } from '@/lib/phone'
import twilio from 'twilio'
import { z } from 'zod'

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

  const service = await createSupabaseServiceClient()

  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Officials in one tenant may share a name but not a phone number — the phone is
  // what invite confirmation binds against (0017/0018). Checked here as well as by the
  // partial unique index from 0020 so the rule still holds if a database is behind on
  // migrations; the index is what makes it race-proof, handled below.
  const { data: duplicate } = await service
    .from('officials')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .neq('invite_status', 'removed')
    .limit(1)
    .maybeSingle()

  if (duplicate) {
    return NextResponse.json(
      { error: 'An official with this phone number already exists', code: 'duplicate_phone' },
      { status: 409 }
    )
  }

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

  // Two concurrent requests can both pass the check above; the unique index is the
  // real guarantee, so translate its violation into the same 409 rather than a 500.
  if (error?.code === '23505') {
    return NextResponse.json(
      { error: 'An official with this phone number already exists', code: 'duplicate_phone' },
      { status: 409 }
    )
  }

  if (error || !official) {
    return NextResponse.json({ error: 'Failed to create official' }, { status: 500 })
  }

  const { data: tenant } = await service.from('tenants').select('name').eq('id', tenantId).single()

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
      to: phone,
    })
  } catch (err) {
    smsSent = false
    // Log the DB-generated id and Twilio's numeric code only — never the raw error,
    // which can echo the submitted phone number back into the logs.
    //
    // One pre-formatted string, and never an undefined argument: console patching by
    // editor extensions can throw on those, and a throw here would escape this catch
    // and turn a handled SMS failure back into a 500.
    const code = (err as { code?: unknown } | null)?.code
    try {
      console.error(
        `Invite SMS failed for official ${official.id} (twilio code: ${code ?? 'none'})`
      )
    } catch {
      // A throw here would escape the outer catch and turn a handled SMS failure back
      // into a 500. Editor extensions that patch console can throw; logging must never
      // be able to change the response.
    }
  }

  return NextResponse.json({ official, smsSent })
}
