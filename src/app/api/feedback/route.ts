import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { logger } from '@/lib/logger'
import { FEEDBACK_TYPES } from '@/types/app'
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_BUCKET,
  FEEDBACK_IMAGE_MAX_BYTES,
  FEEDBACK_IMAGE_TYPES,
  FEEDBACK_PAGE_PATH_MAX,
  FEEDBACK_RATE_LIMIT,
  FEEDBACK_RATE_WINDOW_MS,
  FEEDBACK_SURFACES,
  FEEDBACK_TITLE_MAX,
  feedbackImagePath,
  pickFeedbackRole,
} from '@/lib/feedback/feedback'

// N71: send feedback (question / bug / feature request) with one optional
// image.
//
// A route handler rather than a Server Action because of the image: Server
// Actions cap the request body at 1 MB by default, and the image may be 5 MB.
// Same multipart shape as POST /api/claim/photo.
//
// Everything goes through the caller's own RLS client — no service role. The
// insert policy (can_insert_feedback) re-checks user, role, event and image
// path, so the checks here are the defense-in-depth layer and the source of
// clean 4xx answers, not the only gate.
//
// ORDER: image first, row second. Storage cannot join a Postgres
// transaction, so the two writes cannot be atomic (this is one table plus an
// object store, not the multi-table case REL-01's "wrap it in one RPC"
// covers). Of the two possible leftovers, a file nobody references is
// invisible, while a row pointing at a missing file is a broken card on the
// triage page — so the upload goes first, and a failed insert removes it
// again (storage allows deleting your own upload while no row references it).

const OP = 'POST /api/feedback'

const fieldsSchema = z.object({
  tenantId: z.string().uuid(),
  eventId: z.string().uuid().optional(),
  surface: z.enum(FEEDBACK_SURFACES),
  type: z.enum(FEEDBACK_TYPES),
  title: z.string().trim().min(1).max(FEEDBACK_TITLE_MAX),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  // The page the user came from — an app path, never a full URL.
  pagePath: z.string().startsWith('/').max(FEEDBACK_PAGE_PATH_MAX),
})

// FormData.get() returns null for a missing field; zod's optional() wants
// undefined. An empty string (an unset <input>) counts as missing too.
function field(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  return typeof value === 'string' && value !== '' ? value : undefined
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, { op: OP, table: 'auth.users', kind: 'select' })
  }
  const user = auth.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const parsed = fieldsSchema.safeParse({
    tenantId: field(form, 'tenantId'),
    eventId: field(form, 'eventId'),
    surface: field(form, 'surface'),
    type: field(form, 'type'),
    title: field(form, 'title'),
    body: field(form, 'body'),
    pagePath: field(form, 'pagePath'),
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // An <input type="file"> left empty still sends a File, of size 0.
  const rawFile = form.get('image')
  const image = rawFile instanceof File && rawFile.size > 0 ? rawFile : null
  if (image) {
    if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(image.type)) {
      return NextResponse.json({ error: 'Unsupported type', code: 'type' }, { status: 400 })
    }
    if (image.size > FEEDBACK_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: 'Too large', code: 'size' }, { status: 413 })
    }
  }

  const { tenantId, eventId, surface, type, title, body, pagePath } = parsed.data

  // The caller's roles in this tenant, through their own RLS read of
  // user_roles. Never taken from the request.
  const { data: roleRows, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
  if (rolesError) {
    logQueryError(rolesError, { op: OP, table: 'user_roles', kind: 'select' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  const userRole = pickFeedbackRole(
    surface,
    (roleRows ?? []).map((r) => r.role)
  )
  if (!userRole) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Flood guard, counted over the caller's own rows (all they can see anyway).
  const since = new Date(Date.now() - FEEDBACK_RATE_WINDOW_MS).toISOString()
  const { count, error: countError } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)
  if (countError) {
    logQueryError(countError, { op: OP, table: 'feedback', kind: 'select' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if ((count ?? 0) >= FEEDBACK_RATE_LIMIT) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate' }, { status: 429 })
  }

  // The id is chosen here, not by the column default, because the image path
  // has to contain it before the row exists.
  const feedbackId = randomUUID()
  let imagePath: string | null = null

  if (image) {
    imagePath = feedbackImagePath(tenantId, user.id, feedbackId, image.type)
    const { error: uploadError } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .upload(imagePath, image, { contentType: image.type, upsert: false })
    if (uploadError) {
      logger.error(`${OP}: image upload failed`, uploadError, { tenantId })
      return NextResponse.json({ error: 'Upload failed', code: 'upload' }, { status: 500 })
    }
  }

  const { error: insertError } = await supabase.from('feedback').insert({
    id: feedbackId,
    tenant_id: tenantId,
    event_id: eventId ?? null,
    user_id: user.id,
    user_role: userRole,
    type,
    title,
    body,
    page_path: pagePath,
    image_path: imagePath,
  })

  if (insertError) {
    logQueryError(insertError, { op: OP, table: 'feedback', kind: 'insert' })
    if (imagePath) {
      // Best effort: the user already gets an error for the insert, and a
      // leftover file is invisible (nothing references it).
      const { error: removeError } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .remove([imagePath])
      if (removeError) {
        logger.warn(`${OP}: could not remove the orphaned image`, {
          tenantId,
          message: removeError.message,
        })
      }
    }
    // 42501: the insert policy refused — e.g. an event from another tenant.
    const status = (insertError as { code?: string }).code === '42501' ? 403 : 500
    return NextResponse.json({ error: status === 403 ? 'Forbidden' : 'Internal error' }, { status })
  }

  return NextResponse.json({ ok: true, id: feedbackId }, { status: 201 })
}
