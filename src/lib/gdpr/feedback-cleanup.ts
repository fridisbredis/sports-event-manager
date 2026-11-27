import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

// N80 / SEC-09: deletes the feedback (N71) of everyone inactive for 24+
// months — the row and its optional image. The rows come from
// list_gdpr_feedback_cleanup() (migration 20261127145159), which also records
// Peter's decision and why this is not part of anonymize_inactive_users().
//
// Order matters: the image goes first, the row after. A row whose image
// removal failed keeps its image_path and is listed again on the next daily
// run — the row is the retry queue. Removing an image that is already gone is
// not an error in the Storage API, so a row whose delete failed after its
// image was removed simply succeeds on the next run.
//
// Only the object image_path names is removed, not its folder: the path is
// {tenantId}/{userId}/{feedbackId}/{filename}, one folder per feedback row,
// and the form uploads exactly one image per row (a failed insert deletes its
// upload again — see the IMAGES note in 20261127094110).

const BUCKET = 'feedback-images'
const OP = 'POST /api/cron/gdpr-warning'

export interface FeedbackCleanupResult {
  /** Feedback rows deleted (with their image, if any). */
  deleted: number
  /** Rows left for the next run (storage or delete failure, logged). */
  failed: number
  /** The candidate list could not be read, so nothing was attempted (logged). */
  listFailed: boolean
}

export async function removeExpiredFeedback(
  service: SupabaseClient<Database>
): Promise<FeedbackCleanupResult> {
  const result: FeedbackCleanupResult = { deleted: 0, failed: 0, listFailed: false }

  const { data: rows, error } = await service.rpc('list_gdpr_feedback_cleanup')
  if (error) {
    // Nothing is deleted this run; the rows stay listed until it works.
    logQueryError(error, {
      op: OP,
      table: 'list_gdpr_feedback_cleanup',
      kind: 'rpc',
      extra: { consequence: 'gdpr_feedback_not_removed' },
    })
    result.listFailed = true
    return result
  }

  for (const row of rows ?? []) {
    if (row.image_path) {
      const { error: removeError } = await service.storage.from(BUCKET).remove([row.image_path])
      if (removeError) {
        logQueryError(removeError, {
          op: OP,
          table: 'storage.objects',
          kind: 'delete',
          tenantId: row.feedback_tenant_id,
          extra: { usage: 'gdpr_feedback_image_remove', feedbackId: row.feedback_id },
        })
        result.failed += 1
        continue
      }
    }

    const { error: deleteError } = await service
      .from('feedback')
      .delete()
      .eq('id', row.feedback_id)
      .eq('tenant_id', row.feedback_tenant_id)

    if (deleteError) {
      // The image is gone, the row still points at it: the triage page shows
      // the card without its image, and the next run lists the row again and
      // deletes it.
      logQueryError(deleteError, {
        op: OP,
        table: 'feedback',
        kind: 'delete',
        tenantId: row.feedback_tenant_id,
        extra: { usage: 'gdpr_feedback_delete', feedbackId: row.feedback_id },
      })
      result.failed += 1
      continue
    }

    result.deleted += 1
  }

  return result
}
