import type { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

// Whether this user has hidden the onboarding guide for this event
// (admin_guide_dismissals, migration 20261123120310).
//
// Fails open: a failed read is logged and the guide is shown. Hiding a guide
// is a convenience, and an error here must not take the dashboard down with it.
export async function fetchAdminGuideDismissed(
  supabase: SupabaseClient,
  userId: string,
  eventId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('admin_guide_dismissals')
    .select('event_id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) {
    logQueryError(error, {
      op: 'fetchAdminGuideDismissed',
      table: 'admin_guide_dismissals',
      kind: 'select',
    })
    return false
  }

  return data !== null
}
