import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'
import type { IceContact } from '@/lib/ice-contact'

/**
 * N37 reads of user_ice_contacts. Both go through the caller's RLS client:
 * the policies (migration 20261109141949) are what decide whose contact the
 * caller may see, so these never need — and must never use — service_role.
 *
 * Neither throws. An ICE contact is one block on a screen whose main job is
 * something else (the account form, the roster); failing the page over it
 * would be the worse trade. A failed read logs (F-REL-10) and reads as "no
 * contact", which the screens already have wording for.
 */

/** The signed-in user's own contact, for ACCT-01. */
export async function fetchOwnIceContact(
  supabase: SupabaseClient<Database>,
  userId: string,
  op: string
): Promise<IceContact | null> {
  const { data, error } = await supabase
    .from('user_ice_contacts')
    .select('phone, name, relation')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    logQueryError(error, { op, table: 'user_ice_contacts', kind: 'select' })
    return null
  }

  return data ? { phone: data.phone, name: data.name, relation: data.relation } : null
}

/**
 * Contacts for a set of users, keyed by user id, for OFF-01. Users without a
 * contact — or whose contact RLS hides from the caller — are simply absent.
 */
export async function fetchIceContactsByUserId(
  supabase: SupabaseClient<Database>,
  userIds: string[],
  ctx: { op: string; tenantId: string }
): Promise<Record<string, IceContact>> {
  if (userIds.length === 0) return {}

  const { data, error } = await supabase
    .from('user_ice_contacts')
    .select('user_id, phone, name, relation')
    .in('user_id', userIds)

  if (error) {
    logQueryError(error, {
      op: ctx.op,
      table: 'user_ice_contacts',
      kind: 'select',
      tenantId: ctx.tenantId,
    })
    return {}
  }

  return Object.fromEntries(
    (data ?? []).map((row) => [
      row.user_id,
      { phone: row.phone, name: row.name, relation: row.relation },
    ])
  )
}
