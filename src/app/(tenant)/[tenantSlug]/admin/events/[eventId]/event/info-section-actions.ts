'use server'

// N38: info sections on EVT-02. Each section is saved, removed and reordered
// on its own, the moment the admin confirms the modal or moves a row — not
// through the page's Save button. A section is a self-contained thing the
// admin finishes in a modal, and an image upload is already a completed
// action (see uploadEventLogo), so holding sections back until Save would
// leave uploaded files with no row behind them whenever the admin navigates
// away.

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError, translateStorageError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { eventInfoCacheTag, adminEventCacheTag } from '@/lib/cache/tags'
import { adminEventRoutePattern } from '@/lib/events/paths'
import { normalizeResultsUrl } from './_utils'
import {
  INFO_SECTION_BUCKET,
  INFO_SECTION_IMAGE_TYPES,
  INFO_SECTION_MAX_IMAGE_BYTES,
  INFO_SECTION_LIMITS,
} from './_info-section-rules'

export type InfoSectionField = 'title' | 'content' | 'link' | 'image'

export interface InfoSectionResult {
  error?: string
  /** Which modal field the error belongs to, when it belongs to one. */
  field?: InfoSectionField
}

const idsSchema = z.object({
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
})

const sectionIdSchema = z.string().uuid()

function str(formData: FormData, key: string): string {
  const v = formData.get(key)
  return typeof v === 'string' ? v : ''
}

function invalidate(tenantId: string) {
  revalidatePath(adminEventRoutePattern('event'), 'page')
  updateTag(eventInfoCacheTag(tenantId))
  updateTag(adminEventCacheTag(tenantId))
}

/**
 * Adds a section (no `sectionId`) or edits one. FormData fields: tenantId,
 * eventId, sectionId?, title, body, linkUrl, linkLabel, removeImage ('1'),
 * image (File, optional — already downscaled to WebP by the client).
 *
 * Order of writes, same reasoning as uploadEventLogo: new file first, then
 * the row, then the old file. A failed row write removes the new file; the
 * old file is only removed once the row no longer points at it.
 */
export async function saveInfoSection(formData: FormData): Promise<InfoSectionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const ids = idsSchema.safeParse({
    tenantId: str(formData, 'tenantId'),
    eventId: str(formData, 'eventId'),
  })
  if (!ids.success) {
    logger.warn('saveInfoSection: invalid ids')
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }
  const { tenantId, eventId } = ids.data

  const rawSectionId = str(formData, 'sectionId')
  const existingId = rawSectionId ? sectionIdSchema.safeParse(rawSectionId) : null
  if (existingId && !existingId.success) {
    logger.warn('saveInfoSection: invalid sectionId')
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  if (!(await hasAdminAccessToTenant(user.id, tenantId)))
    return { error: await tError('actionErrors.notAuthorized') }

  // ---- validate the fields (the modal checks the same; this is the boundary)
  const title = str(formData, 'title').trim()
  if (!title)
    return { error: await tError('actionErrors.infoSectionTitleRequired'), field: 'title' }
  if (title.length > INFO_SECTION_LIMITS.title)
    return { error: await tError('actionErrors.infoSectionTitleTooLong'), field: 'title' }

  const body = str(formData, 'body').trim()
  if (body.length > INFO_SECTION_LIMITS.body)
    return { error: await tError('actionErrors.infoSectionBodyTooLong'), field: 'content' }

  const link = normalizeResultsUrl(str(formData, 'linkUrl'))
  if (!link.ok) return { error: await tError('actionErrors.infoSectionLinkInvalid'), field: 'link' }
  const linkLabel = str(formData, 'linkLabel').trim().slice(0, INFO_SECTION_LIMITS.linkLabel)

  const image = formData.get('image')
  const newImage = image instanceof File && image.size > 0 ? image : null
  if (newImage) {
    if (!(INFO_SECTION_IMAGE_TYPES as readonly string[]).includes(newImage.type))
      return { error: await tError('actionErrors.chooseImageFile'), field: 'image' }
    if (newImage.size > INFO_SECTION_MAX_IMAGE_BYTES)
      return { error: await tError('actionErrors.imageTooLarge'), field: 'image' }
  }
  const removeImage = str(formData, 'removeImage') === '1'

  // The current image comes from the row, never from the client: a stale or
  // forged value must not be able to point a removal at another file.
  let currentImagePath: string | null = null
  if (existingId) {
    const { data: current, error: readError } = await supabase
      .from('event_info_sections')
      .select('image_path')
      .eq('id', existingId.data)
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .single()
    if (readError)
      return { error: await translateDbError('saveInfoSection: section lookup failed', readError) }
    currentImagePath = current.image_path
  }

  const keptImagePath = newImage || removeImage ? null : currentImagePath
  // L23: a title plus at least one of text, image and link.
  if (!body && !newImage && !keptImagePath && !link.value)
    return { error: await tError('actionErrors.infoSectionNeedsContent'), field: 'content' }

  const sectionId = existingId?.data ?? crypto.randomUUID()

  // ---- 1. new file
  let uploadedPath: string | null = null
  if (newImage) {
    uploadedPath = `${tenantId}/${eventId}/${sectionId}/${Date.now()}.webp`
    const { error: uploadError } = await supabase.storage
      .from(INFO_SECTION_BUCKET)
      .upload(uploadedPath, newImage, { contentType: newImage.type })
    if (uploadError)
      return {
        error: await translateStorageError('saveInfoSection: storage upload failed', uploadError),
        field: 'image',
      }
  }

  // ---- 2. the row
  const fields = {
    title,
    body: body || null,
    image_path: uploadedPath ?? keptImagePath,
    link_url: link.value,
    link_label: link.value && linkLabel ? linkLabel : null,
  }

  let writeError
  if (existingId) {
    ;({ error: writeError } = await supabase
      .from('event_info_sections')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', sectionId)
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId))
  } else {
    // New sections go last. Read under RLS, so only this event's rows count.
    const { data: last } = await supabase
      .from('event_info_sections')
      .select('position')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    ;({ error: writeError } = await supabase.from('event_info_sections').insert({
      id: sectionId,
      tenant_id: tenantId,
      event_id: eventId,
      position: (last?.position ?? -1) + 1,
      ...fields,
    }))
  }

  if (writeError) {
    if (uploadedPath) await supabase.storage.from(INFO_SECTION_BUCKET).remove([uploadedPath])
    return { error: await translateDbError('saveInfoSection: section write failed', writeError) }
  }

  // ---- 3. old file, best effort: an orphaned object is harmless.
  if (currentImagePath && currentImagePath !== fields.image_path) {
    await supabase.storage.from(INFO_SECTION_BUCKET).remove([currentImagePath])
  }

  invalidate(tenantId)
  return {}
}

export async function deleteInfoSection(
  tenantId: string,
  eventId: string,
  sectionId: string
): Promise<InfoSectionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const ids = idsSchema.safeParse({ tenantId, eventId })
  const id = sectionIdSchema.safeParse(sectionId)
  if (!ids.success || !id.success) {
    logger.warn('deleteInfoSection: invalid ids')
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  if (!(await hasAdminAccessToTenant(user.id, ids.data.tenantId)))
    return { error: await tError('actionErrors.notAuthorized') }

  const { data: deleted, error } = await supabase
    .from('event_info_sections')
    .delete()
    .eq('id', id.data)
    .eq('event_id', ids.data.eventId)
    .eq('tenant_id', ids.data.tenantId)
    .select('image_path')
    .maybeSingle()

  if (error) return { error: await translateDbError('deleteInfoSection: delete failed', error) }

  // Row first, file second, as removeEventLogo.
  if (deleted?.image_path) {
    await supabase.storage.from(INFO_SECTION_BUCKET).remove([deleted.image_path])
  }

  invalidate(ids.data.tenantId)
  return {}
}

/** Saves the admin's order: `orderedIds` must be every section of the event. */
export async function reorderInfoSections(
  tenantId: string,
  eventId: string,
  orderedIds: string[]
): Promise<InfoSectionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const ids = idsSchema.safeParse({ tenantId, eventId })
  const order = z.array(z.string().uuid()).max(200).safeParse(orderedIds)
  if (!ids.success || !order.success) {
    logger.warn('reorderInfoSections: invalid input')
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  if (!(await hasAdminAccessToTenant(user.id, ids.data.tenantId)))
    return { error: await tError('actionErrors.notAuthorized') }

  const { error } = await supabase.rpc('reorder_event_info_sections', {
    p_tenant_id: ids.data.tenantId,
    p_event_id: ids.data.eventId,
    p_ids: order.data,
  })
  if (error) return { error: await translateDbError('reorderInfoSections: rpc failed', error) }

  invalidate(ids.data.tenantId)
  return {}
}
