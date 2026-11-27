import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { Feedback } from '@/types/app'
import { logQueryError } from '@/lib/db/query-error'

export type OwnFeedback = Pick<
  Feedback,
  'id' | 'type' | 'title' | 'body' | 'status' | 'created_at' | 'image_path'
>

// Enough for anyone's own history; a list past this is not one person's
// feedback in any realistic use, and the page stays one bounded read.
const OWN_FEEDBACK_LIMIT = 50

/**
 * The caller's own feedback in one tenant, newest first, through their RLS
 * client (feedback_select_own_or_system_admin). Filtered on user_id as well:
 * for a system admin the policy returns every row, and "my feedback" must
 * still mean their own.
 *
 * A failed read returns `failed: true` rather than an empty list (F-REL-10):
 * the page says the list could not be loaded instead of claiming the user
 * has never sent anything.
 */
export async function fetchOwnFeedback(
  supabase: SupabaseClient<Database>,
  userId: string,
  tenantId: string
): Promise<{ rows: OwnFeedback[]; failed: boolean }> {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, type, title, body, status, created_at, image_path')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(OWN_FEEDBACK_LIMIT)

  if (error) {
    logQueryError(error, { op: 'fetchOwnFeedback', table: 'feedback', kind: 'select' })
    return { rows: [], failed: true }
  }
  return { rows: (data ?? []) as OwnFeedback[], failed: false }
}
