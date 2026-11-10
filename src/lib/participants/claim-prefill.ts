import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'
import { fetchOwnIceContact } from '@/lib/ice-contact-read'
import type { IceContact } from '@/lib/ice-contact'
import { locales, type Locale } from '@/lib/i18n/config'

// N40 (CLAIM-02 existing-account, L5, L13): what the form knows about the
// person once their code is verified.
//
// Every read goes through the caller's RLS client and touches only the
// caller's own rows (user_read_own_role, participant_read_own, the own-row
// officials/ICE/preferences policies). Nothing here can name another user.
//
// Nothing here throws: this fills in a form, and a failed read degrades to an
// empty field the runner can fill in themselves. The two flags that matter
// for correctness — already claimed, already in the event — are enforced
// again by complete_participant_claim, so a failed read cannot let a second
// claim through; it only loses the early warning.

export interface ClaimPrefill {
  /** The number already has a role in this tenant (official, admin or participant). */
  existingAccount: boolean
  /** L13: linked to a DIFFERENT participant in this event. Complete is blocked. */
  alreadyInEvent: boolean
  /** This very participant is already theirs — a repeated claim. */
  claimedByYou: boolean
  /** A photo they already have in this tenant, to keep on the new row. */
  avatarUrl: string | null
  ice: IceContact | null
  language: Locale | null
}

export async function loadClaimPrefill(
  supabase: SupabaseClient<Database>,
  ctx: { userId: string; tenantId: string; eventId: string; participantId: string; op: string }
): Promise<ClaimPrefill> {
  const { userId, tenantId, eventId, participantId, op } = ctx

  const [roles, ownRows, official, ice, prefs] = await Promise.all([
    supabase.from('user_roles').select('role').eq('user_id', userId).eq('tenant_id', tenantId),
    supabase
      .from('participants')
      .select('id, event_id, avatar_url')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId),
    // The same "confirmed rows only, newest first" rule ACCT-01 uses for the
    // official's avatar: a soft-deleted invite row can still carry an old one.
    supabase
      .from('officials')
      .select('avatar_url')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('invite_status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fetchOwnIceContact(supabase, userId, op),
    supabase.from('user_preferences').select('language').eq('user_id', userId).maybeSingle(),
  ])

  for (const [table, result] of [
    ['user_roles', roles],
    ['participants', ownRows],
    ['officials', official],
    ['user_preferences', prefs],
  ] as const) {
    if (result.error) logQueryError(result.error, { op, table, kind: 'select', tenantId })
  }

  const rows = ownRows.data ?? []
  const otherRowPhoto = rows.find((r) => r.id !== participantId && r.avatar_url)?.avatar_url
  const language = prefs.data?.language

  return {
    existingAccount: (roles.data?.length ?? 0) > 0,
    alreadyInEvent: rows.some((r) => r.event_id === eventId && r.id !== participantId),
    claimedByYou: rows.some((r) => r.id === participantId),
    avatarUrl:
      rows.find((r) => r.id === participantId)?.avatar_url ??
      official.data?.avatar_url ??
      otherRowPhoto ??
      null,
    ice,
    language: locales.includes(language as Locale) ? (language as Locale) : null,
  }
}
