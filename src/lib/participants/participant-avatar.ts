import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

// N40 (L8): the participant's photo, participants.avatar_url
// (migration 20261110130000). Same bucket and limits as an official's avatar
// (src/lib/actions/avatar.ts), under its own prefix:
//
//   avatars/{tenantId}/participants/{participantId}/{timestamp}.{ext}
//
// Written with the service role. A participant has no self-update policy on
// participants, and must not get one: it would let them rewrite their own
// bib and name, which belong to Race Results (L14). So the CALLER proves
// ownership — the row's user_id is the verified session's user — before
// anything here runs, and every write is filtered on that user_id as well.

const BUCKET = 'avatars'

// Same backstop as the official avatar: the client resizes to a 512 px WebP
// first, so a real upload is far below this.
export const MAX_PARTICIPANT_AVATAR_BYTES = 900 * 1024
export const ALLOWED_PARTICIPANT_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function extOf(contentType: string): string {
  return contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
}

export function avatarStoragePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

interface Target {
  tenantId: string
  participantId: string
  userId: string
}

async function pointRowAt(
  service: SupabaseClient<Database>,
  target: Target,
  path: string,
  op: string
): Promise<string | null> {
  const {
    data: { publicUrl },
  } = service.storage.from(BUCKET).getPublicUrl(path)

  // Only for the cleanup below. A failed read is logged and means the old
  // object is left in place — never that the new photo is not saved.
  const { data: previous, error: previousError } = await service
    .from('participants')
    .select('avatar_url')
    .eq('id', target.participantId)
    .eq('tenant_id', target.tenantId)
    .eq('user_id', target.userId)
    .maybeSingle()
  if (previousError) {
    logQueryError(previousError, {
      op,
      table: 'participants',
      kind: 'select',
      tenantId: target.tenantId,
      extra: { usage: 'participant_avatar_previous' },
    })
  }

  const { data: updated, error } = await service
    .from('participants')
    .update({ avatar_url: publicUrl })
    .eq('id', target.participantId)
    .eq('tenant_id', target.tenantId)
    .eq('user_id', target.userId)
    .select('id')
    .maybeSingle()

  if (error || !updated) {
    // An object no row points at is an orphan nobody can clean up later.
    await service.storage.from(BUCKET).remove([path])
    logQueryError(error, {
      op,
      table: 'participants',
      kind: 'update',
      tenantId: target.tenantId,
      extra: { usage: 'participant_avatar', matchedNoRow: !error && !updated },
    })
    return null
  }

  // Best-effort: a leftover object costs storage, a failed delete must not
  // fail a photo that is already saved. Only our own prefix is ever removed —
  // a previous URL copied from somewhere else is not this row's to delete.
  const oldPath = avatarStoragePath(previous?.avatar_url ?? '')
  if (oldPath && oldPath.startsWith(`${target.tenantId}/participants/${target.participantId}/`)) {
    await service.storage.from(BUCKET).remove([oldPath])
  }

  return publicUrl
}

/** Stores an uploaded photo on the participant row. Null on failure (logged). */
export async function saveParticipantAvatar(
  service: SupabaseClient<Database>,
  target: Target,
  file: File,
  op: string
): Promise<string | null> {
  const path = `${target.tenantId}/participants/${target.participantId}/${Date.now()}.${extOf(file.type)}`

  const { error } = await service.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (error) {
    logQueryError(error, {
      op,
      table: 'storage.objects',
      kind: 'insert',
      tenantId: target.tenantId,
      extra: { usage: 'participant_avatar' },
    })
    return null
  }

  return pointRowAt(service, target, path, op)
}

/**
 * L5/L8: someone who already has a photo in the tenant (as an official, or as
 * a participant in another event) keeps it on the new participant row.
 *
 * Copied, not shared by URL: each row owns its own object, so replacing or
 * deleting one picture can never take the other one with it.
 */
export async function copyAvatarToParticipant(
  service: SupabaseClient<Database>,
  target: Target,
  sourceUrl: string,
  op: string
): Promise<string | null> {
  const from = avatarStoragePath(sourceUrl)
  // Only objects in this tenant's own folder are copied — a URL pointing
  // anywhere else is not something this row should inherit.
  if (!from || !from.startsWith(`${target.tenantId}/`)) return null

  const ext = from.split('.').pop() ?? 'jpg'
  const to = `${target.tenantId}/participants/${target.participantId}/${Date.now()}.${ext}`

  const { error } = await service.storage.from(BUCKET).copy(from, to)
  if (error) {
    logQueryError(error, {
      op,
      table: 'storage.objects',
      kind: 'insert',
      tenantId: target.tenantId,
      extra: { usage: 'participant_avatar_copy' },
    })
    return null
  }

  return pointRowAt(service, target, to, op)
}
