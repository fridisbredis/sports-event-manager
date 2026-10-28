import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// N23: the event an admin API request acts on. Route handlers take it in the
// body next to tenantId and must not trust it: it has to be one of the
// tenant's events, read through the caller's RLS client.
//
// eventId is optional for the length of a deploy window — a page loaded
// before the deploy posts without it. Then the tenant's only non-archived
// event is used, and a tenant with none or several gets null rather than a
// guess; the caller answers 400.
export async function resolveRequestEventId(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  eventId: string | undefined
): Promise<string | null> {
  if (eventId) {
    const { data, error } = await supabase
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) throw error
    return data?.id ?? null
  }

  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenantId)
    .neq('status', 'archived')
    .limit(2)
  if (error) throw error
  return data?.length === 1 ? data[0].id : null
}
