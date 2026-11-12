import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

// B18 / SEC-09: removes the profile photo of everyone whose data is due for
// anonymization (or already anonymized). The rows come from
// list_gdpr_avatar_cleanup() (migration 20261111140445), which also explains
// why this is not part of anonymize_inactive_users().
//
// Order matters: the files go first, avatar_url is nulled after. A row whose
// removal failed keeps its avatar_url and is therefore listed again on the
// next daily run — the column is the retry queue.
//
// The whole folder is removed, not only the object avatar_url points at: a
// replaced photo whose best-effort delete failed is still the same person's
// face. Each row owns exactly one folder (photos are copied between rows,
// never shared — see copyAvatarToParticipant), so this never reaches another
// row's file:
//
//   official:    avatars/{tenantId}/{officialId}/...
//   participant: avatars/{tenantId}/participants/{participantId}/...

const BUCKET = 'avatars'
const OP = 'POST /api/cron/gdpr-warning'
// Supabase's list() returns at most `limit` entries per call.
const PAGE = 100

export interface AvatarCleanupResult {
  /** Rows the photo was removed from. */
  cleared: number
  /** Rows left for the next run (storage or update failure, logged). */
  failed: number
  /** The candidate list could not be read, so nothing was attempted (logged). */
  listFailed: boolean
}

export function avatarFolder(kind: string, tenantId: string, rowId: string): string | null {
  if (kind === 'official') return `${tenantId}/${rowId}`
  if (kind === 'participant') return `${tenantId}/participants/${rowId}`
  return null
}

async function listFolder(
  service: SupabaseClient<Database>,
  folder: string
): Promise<string[] | null> {
  const paths: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await service.storage.from(BUCKET).list(folder, { limit: PAGE, offset })
    if (error) {
      logQueryError(error, {
        op: OP,
        table: 'storage.objects',
        kind: 'select',
        extra: { usage: 'gdpr_avatar_list' },
      })
      return null
    }
    for (const entry of data ?? []) paths.push(`${folder}/${entry.name}`)
    if (!data || data.length < PAGE) return paths
  }
}

export async function removeExpiredAvatars(
  service: SupabaseClient<Database>
): Promise<AvatarCleanupResult> {
  const result: AvatarCleanupResult = { cleared: 0, failed: 0, listFailed: false }

  const { data: rows, error } = await service.rpc('list_gdpr_avatar_cleanup')
  if (error) {
    // Nothing is removed this run; the rows stay listed until it works.
    logQueryError(error, {
      op: OP,
      table: 'list_gdpr_avatar_cleanup',
      kind: 'rpc',
      extra: { consequence: 'gdpr_avatars_not_removed' },
    })
    result.listFailed = true
    return result
  }

  for (const row of rows ?? []) {
    const folder = avatarFolder(row.row_kind, row.row_tenant_id, row.row_id)
    if (!folder) {
      result.failed += 1
      continue
    }

    const paths = await listFolder(service, folder)
    if (!paths) {
      result.failed += 1
      continue
    }

    if (paths.length > 0) {
      const { error: removeError } = await service.storage.from(BUCKET).remove(paths)
      if (removeError) {
        logQueryError(removeError, {
          op: OP,
          table: 'storage.objects',
          kind: 'delete',
          tenantId: row.row_tenant_id,
          extra: { usage: 'gdpr_avatar_remove', rowKind: row.row_kind, rowId: row.row_id },
        })
        result.failed += 1
        continue
      }
    }

    // Filtered on the URL that was listed: if the person signed in and
    // uploaded a new photo in the meantime, their new avatar_url is not ours
    // to clear.
    const table = row.row_kind === 'official' ? 'officials' : 'participants'
    const { error: updateError } = await service
      .from(table)
      .update({ avatar_url: null })
      .eq('id', row.row_id)
      .eq('tenant_id', row.row_tenant_id)
      .eq('avatar_url', row.avatar_url)

    if (updateError) {
      // The file is gone, the row still points at it: the UI falls back to
      // initials on the 404, and the next run lists the row again and clears it.
      logQueryError(updateError, {
        op: OP,
        table,
        kind: 'update',
        tenantId: row.row_tenant_id,
        extra: { usage: 'gdpr_avatar_url_clear', rowId: row.row_id },
      })
      result.failed += 1
      continue
    }

    result.cleared += 1
  }

  return result
}
