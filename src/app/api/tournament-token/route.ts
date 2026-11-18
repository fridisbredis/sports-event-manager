import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getOfficialTenant } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checkTournamentTokenRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { hasFeature } from '@/lib/tiers/features'
import { signTournamentToken } from '@/lib/tournament/token'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { effectivePalette, paletteValues } from '@/lib/theme/tenant-theme-style'
import { logger } from '@/lib/logger'

// ADR-0005 §6.1: issues the token an official takes to the tournament engine,
// for one event at a time. Everything the engine may let them do follows from
// this check, so it is strict:
//
// - Only a confirmed official with a roster row. getOfficialTenant also lets
//   tenant and system admins through, without an officialId; they get 403
//   here. An admin has no role in officials' tournaments (§5.3) unless they
//   are an official on the event themselves.
// - The tenant's tier must include tournaments (premium and up).
// - The official must be a member of THAT event (official_events, N23).
//   Being an official on another event in the same tenant gives nothing.
//
// The tenant is named by slug, as in the official's URL; the event by id.
const requestSchema = z.object({
  tenantSlug: z.string().min(1).max(100),
  eventId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { tenantSlug, eventId } = parsed.data

  // Null for no session, an unknown tenant and a failed access check alike.
  // The proxy has already turned "no session" into a 401 before this point.
  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant?.officialId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { officialId } = tenant

  if (!hasFeature(tenant.tier, 'tournaments')) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'tier_without_tournaments' },
      { status: 403 }
    )
  }

  // The caller's own session: RLS already limits an official to their own
  // memberships, and the filters repeat the scope in case it ever does not.
  const supabase = await createSupabaseServerClient()
  const [membership, official] = await Promise.all([
    supabase
      .from('official_events')
      .select('event_id')
      .eq('official_id', officialId)
      .eq('event_id', eventId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('officials')
      .select('name')
      .eq('id', officialId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ])
  if (membership.error || official.error) {
    logger.error('Tournament token: membership lookup failed', membership.error ?? official.error, {
      officialId,
      eventId,
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!membership.data || !official.data) {
    return NextResponse.json({ error: 'Forbidden', code: 'not_on_event' }, { status: 403 })
  }

  let rateLimit: RateLimitResult
  try {
    rateLimit = await checkTournamentTokenRateLimit(officialId)
  } catch (err) {
    logger.error('Tournament token rate limit check failed', err, { officialId })
    return NextResponse.json({ error: 'Rate limit check failed' }, { status: 503 })
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    )
  }

  // The official's Viadal language, so the tournament app matches it (N55).
  // Never throws: a failed read falls back to the default locale.
  const locale = await getUserLanguage()

  let signed
  try {
    signed = await signTournamentToken({
      officialId,
      name: official.data.name,
      eventId,
      tenantId: tenant.id,
      tier: tenant.tier,
      locale,
      // The palette the official sees in Viadal, through the same tier gate
      // (N52). Tournaments and the colour theme both start at premium today,
      // so this is the tenant's own choice; the gate keeps it right if either
      // tier ever moves.
      palette: paletteValues(effectivePalette(tenant)),
    })
  } catch (err) {
    // A malformed key: a deploy mistake, never the caller's.
    logger.error('Tournament token could not be signed', err)
    return NextResponse.json({ error: 'Tournaments unavailable' }, { status: 503 })
  }
  if (!signed) {
    logger.error(
      'Tournament token blocked: TOURNAMENT_TOKEN_ISSUER or TOURNAMENT_SIGNING_KEY_CURRENT is not set'
    )
    return NextResponse.json({ error: 'Tournaments unavailable' }, { status: 503 })
  }

  // In place of an audit_events row, whose actor_role cannot be an official
  // yet (migration 0037). Ids only: no name, no phone, never the token.
  logger.info('Tournament token issued', { officialId, eventId, tenantId: tenant.id })

  return NextResponse.json(signed, { headers: { 'Cache-Control': 'no-store' } })
}
