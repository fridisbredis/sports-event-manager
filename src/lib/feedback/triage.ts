import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { Feedback } from '@/types/app'
import { logQueryError } from '@/lib/db/query-error'
import { FEEDBACK_BUCKET } from './feedback'

// N71: the system admin's view of every feedback row, across all tenants.
//
// Read through the system admin's own RLS client: feedback_select_own_or_
// system_admin returns every row to them, and officials/participants/tenants/
// events all carry the is_system_admin() clause — so no service role here,
// in line with SEC-03.

export type TriageItem = Pick<
  Feedback,
  | 'id'
  | 'type'
  | 'title'
  | 'body'
  | 'status'
  | 'user_role'
  | 'page_path'
  | 'created_at'
  | 'updated_at'
> & {
  tenantName: string | null
  eventName: string | null
  senderName: string | null
  senderPhone: string | null
  /** Short-lived signed URL, made per page load and never stored. */
  imageUrl: string | null
}

/** Open = still needs someone: new or in progress. */
export const OPEN_STATUSES = ['new', 'in_progress'] as const

// Newest first. Feedback is low volume; past this many the page says the
// list is cut rather than silently dropping the oldest.
export const TRIAGE_LIMIT = 300

// Long enough to look at the page and open an image; short enough that a
// copied link stops working soon after.
const SIGNED_URL_SECONDS = 10 * 60

export async function loadFeedbackTriage(
  supabase: SupabaseClient<Database>,
  { includeClosed }: { includeClosed: boolean }
): Promise<{ items: TriageItem[]; failed: boolean; truncated: boolean }> {
  const OP = 'loadFeedbackTriage'

  let query = supabase
    .from('feedback')
    .select(
      'id, tenant_id, user_id, type, title, body, status, user_role, page_path, image_path, created_at, updated_at, tenants(name), events(name)'
    )
    .order('created_at', { ascending: false })
    // One extra row tells whether the list was cut.
    .limit(TRIAGE_LIMIT + 1)
  if (!includeClosed) query = query.in('status', [...OPEN_STATUSES])

  const { data, error } = await query
  if (error) {
    logQueryError(error, { op: OP, table: 'feedback', kind: 'select' })
    return { items: [], failed: true, truncated: false }
  }

  const truncated = data.length > TRIAGE_LIMIT
  const rows = data.slice(0, TRIAGE_LIMIT)
  if (rows.length === 0) return { items: [], failed: false, truncated: false }

  // Sender names live on the roster rows of that tenant: officials (admins
  // have one too, via ensure_admin_roster_row) and participants. A missing
  // name degrades to the role alone — the feedback itself still shows.
  const userIds = [...new Set(rows.map((r) => r.user_id))]
  const [officials, participants] = await Promise.all([
    supabase.from('officials').select('user_id, tenant_id, name, phone').in('user_id', userIds),
    supabase.from('participants').select('user_id, tenant_id, name, phone').in('user_id', userIds),
  ])
  if (officials.error) {
    logQueryError(officials.error, { op: OP, table: 'officials', kind: 'select' })
  }
  if (participants.error) {
    logQueryError(participants.error, { op: OP, table: 'participants', kind: 'select' })
  }

  const senders = new Map<string, { name: string | null; phone: string | null }>()
  const key = (userId: string | null, tenantId: string) => `${userId}:${tenantId}`
  // Participants first, officials second: a person who is both is described
  // by their roster row, which admins and officials keep up to date.
  for (const p of participants.data ?? []) {
    if (p.name || p.phone)
      senders.set(key(p.user_id, p.tenant_id), { name: p.name, phone: p.phone })
  }
  for (const o of officials.data ?? []) {
    if (o.name || o.phone)
      senders.set(key(o.user_id, o.tenant_id), { name: o.name, phone: o.phone })
  }

  const imagePaths = rows.map((r) => r.image_path).filter((p): p is string => !!p)
  const signed = new Map<string, string>()
  if (imagePaths.length > 0) {
    const { data: urls, error: signError } = await supabase.storage
      .from(FEEDBACK_BUCKET)
      .createSignedUrls(imagePaths, SIGNED_URL_SECONDS)
    if (signError) {
      logQueryError(signError, { op: OP, table: 'storage.objects', kind: 'select' })
    }
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl)
    }
  }

  const items: TriageItem[] = rows.map((r) => {
    const sender = senders.get(key(r.user_id, r.tenant_id))
    return {
      id: r.id,
      type: r.type as TriageItem['type'],
      title: r.title,
      body: r.body,
      status: r.status as TriageItem['status'],
      user_role: r.user_role as TriageItem['user_role'],
      page_path: r.page_path,
      created_at: r.created_at,
      updated_at: r.updated_at,
      tenantName: r.tenants?.name ?? null,
      eventName: r.events?.name ?? null,
      senderName: sender?.name ?? null,
      senderPhone: sender?.phone ?? null,
      imageUrl: r.image_path ? (signed.get(r.image_path) ?? null) : null,
    }
  })

  return { items, failed: false, truncated }
}

/**
 * How many feedback rows still have status 'new' — the badge on the system
 * admin sidebar's Feedback item. Through the caller's RLS client: for a system
 * admin that is every tenant's rows. (Anyone else who reaches the /admin
 * layout gets a 404 from every page under it, and RLS would only count their
 * own rows anyway.) null on a failed read, so the badge is left off rather
 * than showing a wrong 0.
 */
export async function countNewFeedback(supabase: SupabaseClient<Database>): Promise<number | null> {
  const { count, error } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'new')
  if (error) {
    logQueryError(error, { op: 'countNewFeedback', table: 'feedback', kind: 'select' })
    return null
  }
  return count ?? 0
}
