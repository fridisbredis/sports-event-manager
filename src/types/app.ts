import type { Database } from './database'

// Row types (what you read from the DB)
type DbTables = Database['public']['Tables']

export type Tenant = DbTables['tenants']['Row']
// status/action/target_type are plain text at the DB level (CHECK
// constraints, not Postgres enums) — narrowed here (SEC-07).
export type AuditEvent = Omit<
  DbTables['audit_events']['Row'],
  'actor_role' | 'action' | 'target_type'
> & {
  actor_role: AuditActorRole
  action: AuditAction
  target_type: AuditTargetType
}
export type AuditEventInsert = DbTables['audit_events']['Insert']
export type AuthEvent = Omit<DbTables['auth_events']['Row'], 'event'> & {
  event: AuthEventType
}
export type UserRole = DbTables['user_roles']['Row']
export type Event = DbTables['events']['Row']
export type EventStage = DbTables['event_stages']['Row']
export type EventDistance = DbTables['event_distances']['Row']
export type EventFacility = DbTables['event_facilities']['Row']
export type Workstation = DbTables['workstations']['Row']
export type WorkstationOperatingWindow = DbTables['workstation_operating_windows']['Row']
export type WorkstationTodo = DbTables['workstation_todos']['Row']
export type Official = DbTables['officials']['Row']
// Client-safe projection: excludes invite_token and invite_token_expires_at,
// which are single-use bearer credentials that must never reach the browser (F-SEC-06).
// Also excludes privacy_accepted_at/gdpr_warning_sent_at (SEC-09) — internal GDPR
// bookkeeping the admin officials list has no use for.
export type OfficialListItem = Omit<
  Official,
  'invite_token' | 'invite_token_expires_at' | 'privacy_accepted_at' | 'gdpr_warning_sent_at'
>
export type Participant = DbTables['participants']['Row']
export type Assignment = DbTables['assignments']['Row']
export type Announcement = DbTables['announcements']['Row']
// status is plain text at the DB level (CHECK constraint, not a Postgres
// enum), so the generated Row type has it as `string` — narrow it here.
export type SmsQueueItem = Omit<DbTables['sms_queue']['Row'], 'status'> & {
  status: SmsQueueStatus
}

// Insert types (what you send to the DB when creating)
export type TenantInsert = DbTables['tenants']['Insert']
export type EventInsert = DbTables['events']['Insert']
export type EventStageInsert = DbTables['event_stages']['Insert']
export type WorkstationInsert = DbTables['workstations']['Insert']
export type WorkstationOperatingWindowInsert = DbTables['workstation_operating_windows']['Insert']
export type WorkstationTodoInsert = DbTables['workstation_todos']['Insert']
export type OfficialInsert = DbTables['officials']['Insert']
export type ParticipantInsert = DbTables['participants']['Insert']
export type AssignmentInsert = DbTables['assignments']['Insert']
export type AnnouncementInsert = DbTables['announcements']['Insert']

// Update types (for partial updates)
export type EventUpdate = DbTables['events']['Update']
export type EventDistanceInsert = DbTables['event_distances']['Insert']
export type EventFacilityInsert = DbTables['event_facilities']['Insert']
export type WorkstationUpdate = DbTables['workstations']['Update']
// ...add more as you need them

// Domain enums — stricter than the DB's plain text columns
// These match the CHECK constraints in migrations 0003 + 0007 + 0008
export type TenantRole = 'system_admin' | 'tenant_admin' | 'official' | 'participant'
export type EventStatus = 'draft' | 'published'
export type RaceType = 'distance' | 'time'
export type StageType = 'race' | 'non_race'
// All four values the assignments status CHECK allows
// (0003_phase6_schema.sql:244). Declared as a const tuple, with the type
// derived from it, so there is exactly one list: a zod enum or a UI dropdown
// can iterate the value and still be type-identical to anything annotated
// with AssignmentStatus. The previous two-value type had drifted from the
// CHECK, and actions.ts had forked its own four-value zod enum rather than
// deriving from it.
export const ASSIGNMENT_STATUSES = ['assigned', 'available', 'on_break', 'blocked'] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]
export type AnnouncementChannel = 'officials' | 'participants'
export type OfficialInviteStatus = 'invited' | 'confirmed' | 'removed'
export type SmsQueueStatus = 'pending' | 'sending' | 'sent' | 'failed'
// Match migration 0037's CHECK constraints (SEC-07).
export type AuditActorRole = 'system_admin' | 'tenant_admin'
export type AuditAction =
  | 'role_revoked'
  | 'tenant_created'
  | 'tenant_activated'
  | 'tenant_deactivated'
  | 'tenant_tier_changed'
  | 'official_invited'
  | 'announcement_published'
export type AuditTargetType = 'user_role' | 'tenant' | 'official' | 'announcement'
// Match migration 0038's CHECK constraint (SEC-07-rest). Separate from
// AuditAction/audit_events — see docs/adr/0001 category 5.
export type AuthEventType =
  | 'otp_send_succeeded'
  | 'otp_send_failed'
  | 'otp_send_rate_limited'
  | 'otp_send_rate_limit_error'
  | 'otp_verify_succeeded'
  | 'otp_verify_failed'
  | 'otp_verify_rate_limited'
  | 'otp_verify_rate_limit_error'
  // Match migration 0042's extended CHECK constraint (SEC-07 role-grant gap).
  | 'role_granted_via_invite_confirmation'

// Useful aggregate types for queries that join data
export type WorkstationWithDetails = Workstation & {
  operating_windows: WorkstationOperatingWindow[]
  todos: WorkstationTodo[]
}

export type AssignmentWithRefs = Assignment & {
  workstation: Workstation | null
  todo: WorkstationTodo | null
  official: Official
}
