import { hasFeature } from '@/lib/tiers/features'

// N36 (PB1, PB2, PB5, PB11): publishing opens the PARTICIPANT side of an
// event — the claim list and the participant pages — and nothing else.
// Admin and official screens are open whatever the status; never gate them on
// this.
//
// THE shared check. Every participant-facing page, route handler and action
// (CLAIM-01, PAR-01 and the cards after N36) asks this one question rather
// than comparing `events.status` itself, so the rule has a single home:
//
//   open  =  status is 'published'  AND  the tenant's tier includes publishing
//
// The tier term is not redundant with publish_event's own tier check. A
// tenant that was Premium when it published and has since been moved to
// Standard still has a row stored as 'published'; this keeps that event's
// participant side closed without rewriting the row, and an upgrade back
// reopens it. It also covers a status written past the RPC (a direct UPDATE
// under tenant_admin_manage_events), which no RPC check can see.
//
// An unpublished event keeps every participant record, claim and account
// (PB3): closing is a status change, never a delete. The participant's own
// My account stays reachable while closed (PB10) — that page must not call
// this.
export interface ParticipantSideEvent {
  status: string
}

export function isParticipantSideOpen(event: ParticipantSideEvent, tenantTier: string): boolean {
  return event.status === 'published' && canPublish(tenantTier)
}

// Whether the tenant's plan lets an admin publish at all (PB5). Premium and up.
export function canPublish(tenantTier: string): boolean {
  return hasFeature(tenantTier, 'publish')
}

// The status an ADMIN sees in chips, dots and the events filter (PB11).
// Standard events always show as Draft: a Standard tenant cannot publish, and
// a row stored as 'published' from before a downgrade opens nothing, so
// calling it Published would be untrue. 'archived' is shown as it is.
export function displayedEventStatus(status: string, tenantTier: string): string {
  if (status === 'published' && !canPublish(tenantTier)) return 'draft'
  return status
}
