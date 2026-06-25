# Screen Map / Information Architecture

**Scope:** all screens for v1, grouped by role. Race-admin and official screens are specified from their flows. Participant screens are included as **placeholders** (marked ☐) because their flows are not written yet. System admin screens cover the tenant-management layer.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

Cross-cutting for every screen: all UI strings are i18n (English only in v1, no hardcoded strings); all tenant data is tenant-scoped; the personal-account, event-info, and communication screens are **shared infrastructure** rendered with role-specific content, not duplicated per role. Feature-gated capabilities sit behind the per-tenant toggle layer.

**UI delivery (DECISION 2026-06-24):** one responsive codebase, no separate apps. Admin screens are web-first (reachable but non-optimized on mobile); official/participant screens are mobile-first. Role-based navigation. See open question 2 for the full statement.

## Roles and landing

After sign-in, the user's role determines their landing screen:

- **System admin** → Tenant management.
- **Event admin (tenant admin)** → Event dashboard.
- **Official** → Official home (event info + my schedule + announcements).
- **Participant** ☐ → Participant home (event info + personal view).

## 0. Shared / pre-authentication

- **Sign in** — phone/OTP sign-in (Supabase auth, SMS via Twilio). Entry point for all authenticated roles.
- **Invite confirmation** — reached from the SMS invite link. The official verifies their mobile number and confirms availability, sets name, sees notification default. On completion they become Confirmed. *(Source: officials-management-registration)*

## 1. System admin

- **Tenant management (list)** — all tenants across the platform; create a tenant (provisions the event draft shell), activate/deactivate, see status. *(Source: scope item 6; event-creation-config references the provisioned draft shell)*
- **Tenant detail** — per-tenant activation/deactivation and **feature toggling** by tier (standard/premium/professional; tiers are mutually exclusive, exactly one active per tenant in v1, so this is a single-select). *(Source: scope item 6, feature-toggle non-negotiable)*

## 2. Event admin (tenant admin)

- **Event dashboard** — home for the tenant's single event; entry to all admin areas; shows draft/published state. *(Source: event-creation-config)*
- **Event configuration** — identity (name, type, logo, description), dates/duration, stages/days, venues, distances, facilities, scheduling granularity, and **publish** (draft → published). *(Source: event-creation-config)*
- **Workstations (list)** — all workstations for the event. *(Source: workstation-checklist-config)*
- **Workstation configuration** — identity, one or more operating windows, capacity ("up to X"), and checklists/to-dos with instruction text. *(Source: workstation-checklist-config)*
- **Officials roster** — add/remove officials, send/re-send SMS invite, see Invited/Confirmed state. *(Source: officials-management-registration)*
- **Scheduling** — single assignment model in two editable views via a persistent toggle: **By person** and **By workstation**. Cells show assigned-vs-ceiling; out-of-window cells disabled; only Confirmed officials listed; over-capacity warns. *(Source: officials-scheduling v0.2)*
- **Communication** — publish-only announcements to two separate channels: **participant channel** and **officials channel**. *(Source: communication v0.2)*
- **Personal account** — the admin's own account (shared screen). *(Source: scope item 7)*

## 3. Official (funktionär)

- **Official home** — entry to the screens below. *(Landing)*
- **Event info** — shared read-only "about the event": identity, dates, location/venues, facilities, event programme, and Race Results links (officials can follow competition status). *(Source: event-info-view)*
- **My schedule** — the official's own assignments in **two views**: time view (chronological) and workstation view (grouped per station with that station's checklist). Read-only. *(Source: officials-scheduling v0.2)*
- **Announcements (officials channel)** — read-only officials announcement channel. *(Source: communication v0.2)*
- **Personal account** — name, mobile number (read-only in v1), SMS notification opt-out, link to My schedule. *(Source: official-personal-account)*

## 4. Participant (deltagare) — placeholders ☐

Included so the map is complete; flows to be written next.

- **Participant home** ☐ — entry to the screens below.
- **Event info** ☐ — same shared event-info screen as officials (identity, facilities, location, programme, Race Results links).
- **Personal view** ☐ — the participant's own bib/category and a link to their Race Results page.
- **Announcements (participant channel)** ☐ — read-only participant announcement channel.
- **Personal account** ☐ — name, mobile number, bib/category, Race Results link, SMS notification opt-out.

## 5. External

- **Race Results** — external pages, reached via embedded links from Event info and the participant personal view. No in-house timing/results. *(Source: scope items 3–4)*

## Open questions

1. **Admin's own schedule (DECISION 2026-06-24):** an admin is **always treated as schedulable**. The admin's account appears automatically as the first official/staff member in the roster and in the scheduling grid, with no separate SMS invite or availability confirmation needed (they are implicitly Confirmed). Roles are not mutually exclusive: a user can hold admin rights and be schedulable staff. The personal-account schedule section therefore always exists for admins (may be empty until they have assignments). This resolves the earlier open model question.
2. **UI delivery (DECISION 2026-06-24):** one responsive codebase, no separate apps. **Admin screens are web-first** (designed for desktop; still reachable on mobile in a non-optimized, view-heavy way, e.g. horizontal scroll and some detail hidden, enough to check things like a station's schedule on site). **Official and participant screens are mobile-first** (and work on desktop). Navigation is **role-based** (admin gets the admin menu; official/participant get a simpler set). The **scheduling matrix is edit-on-desktop, view-only on mobile** (see officials-scheduling). The official's "My schedule" and the admin scheduler are **separate views/components** (one shows a single person's detail; the other is a planning matrix that will grow), not a shared component.
3. **Where results links live for officials:** DECISION (Peter 2026-06-24): no separate "Results" screen. Race Results is reached only via links out from Event info (and, for participants, the personal view).
