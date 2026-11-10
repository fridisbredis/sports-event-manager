import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

// N41 (PART-01, EVT-01, L21, L25): who has claimed their participant record.
//
// A record is CLAIMED when participants.user_id is set (claim_participant,
// N35/N40) and UNCLAIMED otherwise. It is in CONFLICT (N42) when it is
// claimed AND at least one other verified claimant is waiting in
// participant_claim_conflicts for an admin's Keep current / Switch to new.
//
// A conflict row is still a claimed row — the first claimant keeps access
// until the admin decides — so it counts toward "28 of 42 claimed" and the
// Claimed filter shows it too (with its Conflict chip). That keeps the
// Claimed filter and the count in the header the same number. The Conflict
// filter narrows to the rows that need a decision.

export const CLAIM_FILTERS = ['all', 'unclaimed', 'claimed', 'conflict'] as const
export type ClaimFilter = (typeof CLAIM_FILTERS)[number]

/** The `claim` search param on PART-01. Anything unknown reads as "all". */
export function parseClaimFilter(value: string | undefined): ClaimFilter {
  return (CLAIM_FILTERS as readonly string[]).includes(value ?? '') ? (value as ClaimFilter) : 'all'
}

export interface ClaimCounts {
  claimed: number
  total: number
  /** N42: records with at least one pending claimant (not claimants). */
  conflicts: number
}

export type ClaimStatus = 'unclaimed' | 'claimed' | 'conflict'

/** One row's status, from its link and its pending claimants. */
export function claimStatusOf(row: { claimed: boolean; pendingClaims: number }): ClaimStatus {
  if (!row.claimed) return 'unclaimed'
  return row.pendingClaims > 0 ? 'conflict' : 'claimed'
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
 * Conflicts (N42) are counted per record, not per claimant: "2 conflicts"
 * means two rows need a decision, however many people are waiting on each.
 * The inner embed returns each participant once.
 *
 * Three head-only counts through the caller's RLS client. Returns null on a
 * failed read (logged, F-REL-10) so the screens can leave the figure out
 * rather than show "0 of 0".
 */
export async function fetchClaimCounts(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; eventId: string; op: string }
): Promise<ClaimCounts | null> {
  const base = (columns = 'id') =>
    supabase
      .from('participants')
      .select(columns, { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .eq('event_id', ctx.eventId)
      .is('withdrawn_at', null)

  const [total, claimed, conflicts] = await Promise.all([
    base(),
    base().not('user_id', 'is', null),
    base('id, participant_claim_conflicts!inner(id)').not('user_id', 'is', null),
  ])

  for (const result of [total, claimed, conflicts]) {
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

  return {
    total: total.count ?? 0,
    claimed: claimed.count ?? 0,
    conflicts: conflicts.count ?? 0,
  }
}
