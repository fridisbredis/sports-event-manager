import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

// N41 (PART-01, EVT-01, L21, L25): who has claimed their participant record.
//
// A record is CLAIMED when participants.user_id is set (claim_participant,
// N35/N40) and UNCLAIMED otherwise. The third status in the wireframes,
// Conflict, has no data behind it until N42 stores a second claimant, so it
// is deliberately absent here rather than a filter that can never match.

export const CLAIM_FILTERS = ['all', 'unclaimed', 'claimed'] as const
export type ClaimFilter = (typeof CLAIM_FILTERS)[number]

/** The `claim` search param on PART-01. Anything unknown reads as "all". */
export function parseClaimFilter(value: string | undefined): ClaimFilter {
  return (CLAIM_FILTERS as readonly string[]).includes(value ?? '') ? (value as ClaimFilter) : 'all'
}

export interface ClaimCounts {
  claimed: number
  total: number
}

/**
 * "28 of 42 claimed", for PART-01's header and EVT-01's participants card.
 *
 * ONE function for both screens, because the card's done-when is that the
 * two numbers match. Read on every render, NOT inside EVT-01's 60-second
 * get_admin_dashboard_cached: an admin who just unlinked someone on PART-01
 * and opens the dashboard must not see the old number.
 *
 * Who counts: everyone still on the start list. Withdrawn rows ("Not on Race
 * Results list") are left out of both numbers — they are no longer racing,
 * and counting them would make "all claimed" unreachable. Hidden rows are
 * counted: hiding tidies the roster, the person is still entered (N34).
 *
 * Two head-only counts through the caller's RLS client. Returns null on a
 * failed read (logged, F-REL-10) so the screens can leave the figure out
 * rather than show "0 of 0".
 */
export async function fetchClaimCounts(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; eventId: string; op: string }
): Promise<ClaimCounts | null> {
  const base = () =>
    supabase
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('event_id', ctx.eventId)
      .is('withdrawn_at', null)

  const [total, claimed] = await Promise.all([base(), base().not('user_id', 'is', null)])

  for (const result of [total, claimed]) {
    if (result.error) {
      logQueryError(result.error, {
        op: ctx.op,
        table: 'participants',
        kind: 'select',
        tenantId: ctx.tenantId,
        extra: { usage: 'claim_counts' },
      })
      return null
    }
  }

  return { total: total.count ?? 0, claimed: claimed.count ?? 0 }
}
