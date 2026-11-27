import type { TenantRole } from '@/types/app'

// N71: in-app feedback. Limits shared by the route handler and the form, so
// the client rejects what the server would reject before uploading 5 MB.
// The title/body caps match the CHECK constraints in migration
// 20261127094110; the image limits match the bucket's own file_size_limit and
// allowed_mime_types, which storage enforces independently of this code.

export const FEEDBACK_TITLE_MAX = 120
export const FEEDBACK_BODY_MAX = 4000
export const FEEDBACK_PAGE_PATH_MAX = 500
export const FEEDBACK_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const FEEDBACK_BUCKET = 'feedback-images'

// Simple flood guard: at most this many submissions per user in the window.
// Generous for a real person, a stop for a stuck retry loop or a script.
export const FEEDBACK_RATE_LIMIT = 10
export const FEEDBACK_RATE_WINDOW_MS = 10 * 60 * 1000

// Which part of the app the feedback was sent from. Decides which role the
// row records — see pickFeedbackRole.
export const FEEDBACK_SURFACES = ['admin', 'official', 'participant'] as const
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number]

/**
 * The role the feedback row records, chosen from the roles the caller holds in
 * the tenant. A person can hold several there (admin + official), so the
 * surface they wrote from decides which one describes them: an admin writing
 * from the official view is still an admin, since the official surface admits
 * admins by role (resolveOfficialSurfaceAccess) without an official row.
 *
 * Returns null when the caller holds no role that admits them to that surface;
 * the route answers 403. The insert policy checks the result again: the role
 * must be one the caller actually holds in the tenant.
 *
 * No system_admin branch: a system admin reaches a tenant's admin view only
 * through their own tenant_admin row there (ADR-0004), so they send as that.
 */
export function pickFeedbackRole(
  surface: FeedbackSurface,
  heldRoles: readonly string[]
): TenantRole | null {
  const holds = (role: TenantRole) => heldRoles.includes(role)
  switch (surface) {
    case 'admin':
      return holds('tenant_admin') ? 'tenant_admin' : null
    case 'official':
      if (holds('official')) return 'official'
      return holds('tenant_admin') ? 'tenant_admin' : null
    case 'participant':
      return holds('participant') ? 'participant' : null
  }
}

function extOf(contentType: string): string {
  return contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
}

/**
 * {tenantId}/{userId}/{feedbackId}/image.{ext} — the exact shape the storage
 * insert policy and the row's insert check require. The file name is fixed
 * rather than the uploaded one: there is one image per feedback, and a
 * user-supplied name has no use here beyond being something to sanitise.
 */
export function feedbackImagePath(
  tenantId: string,
  userId: string,
  feedbackId: string,
  contentType: string
): string {
  return `${tenantId}/${userId}/${feedbackId}/image.${extOf(contentType)}`
}
