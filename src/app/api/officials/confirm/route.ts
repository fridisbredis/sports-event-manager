import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

const confirmSchema = z.object({
  token: z.string().uuid(),
  name: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = confirmSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { token, name } = parsed.data

  // User must be authenticated (OTP verified) before we confirm the invite
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = await createSupabaseServiceClient()

  // Validate token again server-side — never trust client state
  const { data: official } = await service
    .from('officials')
    .select('id, tenant_id, invite_status, invite_token_expires_at, tenants(slug)')
    .eq('invite_token', token)
    .maybeSingle()

  if (
    !official ||
    official.invite_status !== 'invited' ||
    !official.invite_token_expires_at ||
    new Date(official.invite_token_expires_at) <= new Date()
  ) {
    return NextResponse.json({ error: 'Invite not found or expired', code: 'not_found' }, { status: 404 })
  }

  const tenantSlug = (official.tenants as { slug: string } | null)?.slug

  // Confirm: update official, null out token (single-use), create user_roles
  await service
    .from('officials')
    .update({
      user_id: user.id,
      invite_status: 'confirmed',
      invite_token: null,
      invite_token_expires_at: null,
      name,
    })
    .eq('id', official.id)

  // Upsert in case they somehow already have a role (e.g. from the fallback flow)
  await service.from('user_roles').upsert(
    { user_id: user.id, tenant_id: official.tenant_id, role: 'official' },
    { onConflict: 'user_id,tenant_id' }
  )

  return NextResponse.json({ ok: true, tenantSlug })
}
