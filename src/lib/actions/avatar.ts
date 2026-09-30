'use server'

import { redirect } from 'next/navigation'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canViewOfficialSurfaces, hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { translateStorageError } from '@/lib/actions/db-error-message'
import { logQueryError } from '@/lib/db/query-error'
import { officialHomeCacheTag } from '@/lib/cache/tags'
import { getServerTranslation } from '@/lib/i18n/server'
import { defaultLocale } from '@/lib/i18n/config'

const uuidSchema = z.string().uuid()

// Must stay UNDER Next.js's default 1 MB Server Action body cap. Above that
// the request is rejected by the framework with a 413 before this action
// runs, so a larger value here would be advertised in the error copy but
// never actually enforced — the user would just see a generic failure.
// The client downscales to a 512px WebP first (see resizeAvatar), which lands
// well under 100 kB in practice; this is the backstop for anything that
// bypasses it, not the expected path.
const MAX_AVATAR_BYTES = 900 * 1024

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export interface UploadAvatarResult {
  publicUrl?: string
  error?: string
}

function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

/**
 * ACCT-01 profile picture upload. Writes to the 'avatars' bucket under
 * {tenantId}/{officialId}/ and records the public URL on officials.avatar_url.
 *
 * Reachable from both the official and the admin account screens — they render
 * the same AccountForm — so the authorization check accepts either an official
 * editing their own row or a tenant admin acting within their tenant, matching
 * the storage policies in migration 20260929094440.
 */
export async function uploadAvatar(formData: FormData): Promise<UploadAvatarResult> {
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // An expired or missing session is the ordinary path to the redirect below
  // and is not logged. Anything else (Auth unreachable, a 5xx from GoTrue)
  // would otherwise be indistinguishable from it — same reasoning as
  // PATCH /api/account.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'uploadAvatar',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) redirect('/login')

  const t = await getServerTranslation(defaultLocale, 'official')

  const file = formData.get('file')
  const tenantId = formData.get('tenantId')
  const namespace = formData.get('namespace') === 'admin' ? 'admin' : 'official'

  const parsedTenantId = uuidSchema.safeParse(tenantId)
  if (!parsedTenantId.success) return { error: t('account.avatarUploadError') }

  if (!(file instanceof File)) return { error: t('account.avatarUploadError') }
  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) return { error: t('account.avatarTypeError') }
  if (file.size > MAX_AVATAR_BYTES) return { error: t('account.avatarSizeError') }

  const isAdmin = await hasAdminAccessToTenant(user.id, parsedTenantId.data)
  if (!isAdmin && !(await canViewOfficialSurfaces(user.id, parsedTenantId.data))) {
    return { error: t('account.avatarUploadError') }
  }

  // The official row this avatar belongs to. Same "confirmed rows only,
  // newest first" filter the account pages and PATCH /api/account use: a
  // re-invited official still carries the old soft-deleted row on this
  // (user_id, tenant_id), and writing the avatar onto that dead row would
  // store a picture no screen ever reads.
  const { data: official, error: lookupError } = await supabase
    .from('officials')
    .select('id, avatar_url')
    .eq('user_id', user.id)
    .eq('tenant_id', parsedTenantId.data)
    .eq('invite_status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupError || !official) {
    logQueryError(lookupError, {
      op: 'uploadAvatar',
      table: 'officials',
      kind: 'select',
      tenantId: parsedTenantId.data,
      extra: { matchedNoRow: !lookupError && !official },
    })
    return { error: t('account.avatarUploadError') }
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${parsedTenantId.data}/${official.id}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    return {
      error: await translateStorageError(
        'uploadAvatar: storage upload failed',
        uploadError,
        'account.avatarUploadError',
        namespace
      ),
    }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(path)

  const { error: updateError } = await supabase
    .from('officials')
    .update({ avatar_url: publicUrl })
    .eq('id', official.id)
    .eq('tenant_id', parsedTenantId.data)

  if (updateError) {
    // The object is already in the bucket but no row points at it. Remove it
    // rather than leaving an orphan nobody can reach or clean up later.
    await supabase.storage.from('avatars').remove([path])
    logQueryError(updateError, {
      op: 'uploadAvatar',
      table: 'officials',
      kind: 'update',
      tenantId: parsedTenantId.data,
    })
    return { error: t('account.avatarUploadError') }
  }

  // Best-effort cleanup of the previous picture — ignore errors, same as
  // uploadEventLogo. A leftover object costs storage; a failed delete must
  // not fail an upload that already succeeded.
  const oldPath = extractStoragePath(official.avatar_url ?? '', 'avatars')
  if (oldPath) {
    await supabase.storage.from('avatars').remove([oldPath])
  }

  // HOME-01 reads the avatar through the same cached RPC as the greeting name
  // (migration 0050 + this PR's replace), so the new picture would otherwise
  // take up to the 60s revalidate window to appear there. Same { expire: 0 }
  // read-your-own-writes reasoning as PATCH /api/account.
  revalidateTag(officialHomeCacheTag(parsedTenantId.data, user.id), { expire: 0 })

  return { publicUrl }
}
