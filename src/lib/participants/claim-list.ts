import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { isParticipantSideOpen } from '@/lib/events/participant-side'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logQueryError } from '@/lib/db/query-error'
import { effectivePalette } from '@/lib/theme/tenant-theme-style'

import type { ClaimListRow } from './claim-search'

export type { ClaimListRow }

// N39 (CLAIM-01, L9, L10, L11, L12, L29, PB3): the open claim list.
//
// A PUBLIC read. Nobody is signed in, so there is no auth.uid() for RLS to
// work with, and the caller passes the service-role client (ADR-0001,
// category 2: public token-gated flow — the same shape as /invite/[token]).
// That makes this function the whole security boundary, and it is written to
// be one:
//
//   - The token is the only input. The event is found BY the token, and the
//     participants are then read by THAT event's id and tenant id, never by
//     anything the caller supplies. There is no parameter through which
//     another event, or another tenant, could be named.
//   - Only bib, name and a claimed flag leave this function (L29: "nothing
//     else from the event"). user_id is read to compute the flag and dropped;
//     phone, club, category, ICE and the rest are never selected.
//   - Closed (draft, unpublished, or a tier below Premium) returns the event's
//     name and logo for the "not available" screen and NO rows — the
//     participants query is not even run.
//   - An unknown or malformed token returns not_found with nothing about any
//     event, so a guessed link cannot tell "wrong token" from "some event".

export interface ClaimListEvent {
  name: string
  logoUrl: string | null
  /** The tenant's palette, already tier-gated by effectivePalette. */
  palette: string
}

export type ClaimListResult =
  | { kind: 'not_found' }
  | { kind: 'closed'; event: ClaimListEvent }
  | { kind: 'open'; event: ClaimListEvent; participants: ClaimListRow[] }

// Same backstop as PART-01's ceiling. Viadal has 42 participants; the
// ceiling exists so a runaway import is logged rather than silently cut off
// at PostgREST's 1000-row default (the B-series scheduling bug).
export const CLAIM_LIST_CEILING = 2000

// events.claim_token is a uuid column. Checked here because Postgres rejects
// a malformed uuid with 22P02, which would surface as a 500 for what is just
// a mistyped link.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isClaimToken(value: string): boolean {
  return UUID_RE.test(value)
}

// Bibs are text (Race Results sends strings), so Postgres orders "1000"
// before "99". Sorted here with numeric collation, which also keeps
// lettered bibs like "12A" next to 12.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareRows(a: ClaimListRow, b: ClaimListRow): number {
  if (a.bib && b.bib) return collator.compare(a.bib, b.bib)
  if (a.bib) return -1
  if (b.bib) return 1
  return collator.compare(a.name ?? '', b.name ?? '')
}

export async function loadClaimList(
  service: SupabaseClient<Database>,
  token: string
): Promise<ClaimListResult> {
  if (!isClaimToken(token)) return { kind: 'not_found' }

  const { data: event, error: eventError } = await service
    .from('events')
    .select('id, tenant_id, name, logo_url, status, tenants(tier, color_palette)')
    .eq('claim_token', token)
    .maybeSingle()

  if (eventError) {
    logQueryError(eventError, { op: 'claim-list', table: 'events', kind: 'select' })
    throw eventError
  }
  if (!event) return { kind: 'not_found' }

  const tenant = event.tenants as { tier: string; color_palette: string | null } | null
  // An event always has a tenant (FK). If the embed comes back empty anyway,
  // fail closed: treat the tier as unknown, which isParticipantSideOpen
  // refuses.
  const tier = tenant?.tier ?? ''

  const summary: ClaimListEvent = {
    name: event.name,
    logoUrl: event.logo_url,
    palette: effectivePalette({ tier, color_palette: tenant?.color_palette ?? null }),
  }

  // L12 / PB3: open only when published AND the tenant is Premium or up.
  // The one shared check from N36 — not a status comparison of our own.
  if (!isParticipantSideOpen({ status: event.status }, tier)) {
    return { kind: 'closed', event: summary }
  }

  // Withdrawn (struck from the Race Results list, N21) and hidden (taken
  // out of the roster by an admin, N34) rows are not offered: a runner who
  // is not on the start list has nothing to claim, and hiding is the
  // organiser's way of removing an imported row. A struck runner who already
  // claimed keeps their account — that is sign-in, not this page.
  const { data: rows, error: rowsError } = await service
    .from('participants')
    .select('id, bib, name, user_id')
    .eq('tenant_id', event.tenant_id)
    .eq('event_id', event.id)
    .is('withdrawn_at', null)
    .is('hidden_at', null)
    .order('id', { ascending: true })
    // One past the ceiling, so hitting it is detectable.
    .range(0, CLAIM_LIST_CEILING)

  if (rowsError) {
    logQueryError(rowsError, {
      op: 'claim-list',
      table: 'participants',
      kind: 'select',
      tenantId: event.tenant_id,
    })
    throw rowsError
  }

  const bounded = checkReadCeiling(rows ?? [], {
    ceiling: CLAIM_LIST_CEILING,
    page: 'claim-list',
    message: 'Claim list hit its read ceiling — the list is truncated',
    context: { tenantId: event.tenant_id },
  })

  const participants = bounded
    // A row with neither bib nor name cannot be recognised by anyone.
    .filter((p) => p.bib || p.name)
    .map((p) => ({ id: p.id, bib: p.bib, name: p.name, claimed: p.user_id !== null }))
    .sort(compareRows)

  return { kind: 'open', event: summary, participants }
}
