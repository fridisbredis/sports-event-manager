import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// ADR-0005 §6.2: the tournament engine's player list for one Viadal event —
// the event's confirmed officials, as id and display name only. The engine
// calls it server to server when a tournament is opened; an official missing
// from the list counts as removed, and their open matches become byes (§5.5).
//
// No session: src/proxy.ts lets exactly this path shape through, and the
// shared secret TOURNAMENT_ENGINE_SECRET is the only guard, as CRON_SECRET is
// for the cron routes. Unset fails closed (401).
//
// Service role, because there is no user to apply RLS to. That makes this
// handler the only scoping layer, so every query names the event's tenant
// as well as the event, and only id and name ever leave: no phone, no email.
// An event has 10-15 officials (well inside PostgREST's 1000-row page).

export const dynamic = 'force-dynamic'

const eventIdSchema = z.string().uuid()

function isEngine(request: NextRequest): boolean {
  const secret = process.env.TOURNAMENT_ENGINE_SECRET
  const header = request.headers.get('Authorization')
  if (!secret || !header) return false
  // Constant-time, so the response time does not reveal how much of a guess
  // was right. timingSafeEqual needs equal lengths; a length mismatch is a
  // plain no.
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  if (!isEngine(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { eventId } = await params
  if (!eventIdSchema.safeParse(eventId).success) {
    return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
  }

  const service = createSupabaseServiceClient()

  const { data: event, error: eventError } = await service
    .from('events')
    .select('tenant_id')
    .eq('id', eventId)
    .maybeSingle()
  if (eventError) {
    logger.error('Engine officials: event lookup failed', eventError, { eventId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!event) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: memberships, error: membershipError } = await service
    .from('official_events')
    .select('official_id')
    .eq('event_id', eventId)
    .eq('tenant_id', event.tenant_id)
  if (membershipError) {
    logger.error('Engine officials: membership lookup failed', membershipError, { eventId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const officialIds = (memberships ?? []).map((m) => m.official_id)
  let officials: { id: string; name: string }[] = []
  if (officialIds.length > 0) {
    const { data, error } = await service
      .from('officials')
      .select('id, name')
      .in('id', officialIds)
      .eq('tenant_id', event.tenant_id)
      // Invited, declined and removed officials are left out; for the engine a
      // removed official is simply no longer on the list.
      .eq('invite_status', 'confirmed')
      .order('name')
    if (error) {
      logger.error('Engine officials: officials lookup failed', error, { eventId })
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
    officials = data ?? []
  }

  return NextResponse.json(
    { officials: officials.map(({ id, name }) => ({ id, displayName: name })) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
