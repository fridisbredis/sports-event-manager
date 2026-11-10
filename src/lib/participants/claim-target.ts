import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

import { resolveClaimEvent, type ClaimListEvent } from './claim-list'

// N40 (CLAIM-02): the one participant a claim link points at.
//
// The same security boundary as loadClaimList, one row instead of a list. The
// URL carries both the token and the participant id, and the id is NEVER
// trusted on its own: the row is read by id AND the event the token resolved
// to AND that event's tenant. A participant id from another event (even in
// the same tenant) is not_found, exactly like an unknown id, so the page
// cannot be used to probe ids across events.
//
// Withdrawn and hidden rows are not_found too: CLAIM-01 does not offer them,
// and submit_participant_claim refuses them.
//
// Only bib, name and a claimed flag leave this function, as on CLAIM-01.

export interface ClaimTarget {
  id: string
  bib: string | null
  name: string | null
  claimed: boolean
}

export type ClaimTargetResult =
  | { kind: 'not_found' }
  | { kind: 'closed'; event: ClaimListEvent }
  | {
      kind: 'open'
      event: ClaimListEvent
      eventId: string
      tenantId: string
      participant: ClaimTarget
    }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadClaimTarget(
  service: SupabaseClient<Database>,
  token: string,
  participantId: string,
  op = 'claim-target'
): Promise<ClaimTargetResult> {
  const resolved = await resolveClaimEvent(service, token, op)
  if (resolved.kind === 'not_found') return { kind: 'not_found' }
  // Closed wins over the participant lookup: the "not open" screen is the
  // same for every row, so nothing about the id is read or revealed.
  if (resolved.kind === 'closed') return { kind: 'closed', event: resolved.event }

  // participants.id is a uuid column; a malformed id would surface as 22P02.
  if (!UUID_RE.test(participantId)) return { kind: 'not_found' }

  const { data: row, error } = await service
    .from('participants')
    .select('id, bib, name, user_id')
    .eq('id', participantId)
    .eq('event_id', resolved.eventId)
    .eq('tenant_id', resolved.tenantId)
    .is('withdrawn_at', null)
    .is('hidden_at', null)
    .maybeSingle()

  if (error) {
    logQueryError(error, {
      op,
      table: 'participants',
      kind: 'select',
      tenantId: resolved.tenantId,
    })
    throw error
  }
  if (!row) return { kind: 'not_found' }

  return {
    kind: 'open',
    event: resolved.event,
    eventId: resolved.eventId,
    tenantId: resolved.tenantId,
    participant: { id: row.id, bib: row.bib, name: row.name, claimed: row.user_id !== null },
  }
}
