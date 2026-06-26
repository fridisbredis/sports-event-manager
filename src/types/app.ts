import type { Database } from './database'

// Row types (what you read from the DB)
type DbTables = Database['public']['Tables']

export type Tenant = DbTables['tenants']['Row']
export type UserRole = DbTables['user_roles']['Row']
export type Event = DbTables['events']['Row']
export type EventStage = DbTables['event_stages']['Row']
export type EventDistance = DbTables['event_distances']['Row']
export type EventFacility = DbTables['event_facilities']['Row']
export type Workstation = DbTables['workstations']['Row']
export type WorkstationOperatingWindow = DbTables['workstation_operating_windows']['Row']
export type WorkstationTodo = DbTables['workstation_todos']['Row']
export type Official = DbTables['officials']['Row']
export type Participant = DbTables['participants']['Row']
export type Assignment = DbTables['assignments']['Row']
export type Announcement = DbTables['announcements']['Row']

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
// These match the CHECK constraints in migration 0003
export type TenantRole = 'system_admin' | 'tenant_admin' | 'official' | 'participant'
export type EventStatus = 'draft' | 'published'
export type AssignmentStatus = 'assigned' | 'available' | 'on_break' | 'blocked'
export type AnnouncementChannel = 'officials' | 'participants'
export type OfficialInviteStatus = 'pending' | 'confirmed' | 'removed'
//                                  ^^^^^^^^^^^^^^^^^^^^^^^^
// Note: officials.invite_status is text in the DB without a CHECK constraint.
// If we want DB-enforced values, add a CHECK in a later migration.

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
