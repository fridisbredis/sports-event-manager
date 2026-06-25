# Problem Statement & MVP Scope

**Product:** Viadal Event Planner (working title) · **Design driver:** Viadal 6-day running event
**Version:** v0.6 · **Date:** 2026-06-24 · **Owner:** Peter Thorn (product lead) · **Dev:** Frida Bredberg

## Problem

Organizers of multi-day endurance events plan and run their events today on spreadsheets, paper, and scattered messaging. Officials, schedules, workstation duties, participant details, and results live in disconnected places. This causes version confusion, manual handoffs, and fragile execution on event day. There is no single, reliable system to configure an event, invite and schedule officials against workstations and timeslots, give participants their own information, and communicate reliably with both groups. Viadal is the design driver, but the same coordination problem exists across small sport events run by small organizing teams.

## Vision

A multi-tenant web platform where any event organizer can configure their event, invite and schedule officials, give participants a personal view, link to results, and communicate with officials and participants through SMS-backed announcements. Timing and results stay with Race Results; the platform embeds links to their pages and does not compute timing in-house. The platform is built for multiple commercial tenants and multiple feature tiers from day one.

## Target market

Event organizers running small sport events with a race office, a venue, officials staffing workstations on a schedule, and external timing. The platform is multi-tenant from day one, and the domain model is kept event-neutral (event type is a configured attribute) so a swim meet and Viadal are the same model with different configuration. Tournament-format events are explicitly post-MVP, not part of v1.

## Actors

Human roles:

- **System admin:** manages tenants across the platform (activation/deactivation, feature toggling per tenant).
- **Tenant admin (Event admin):** manages a single tenant/event. Configures the event, manages officials, publishes announcements. Unlimited admins per tenant in v1.
- **Official (Event funktionär):** invited via SMS. Assigned to workstations, to-do lists, and timeslots. Views own schedule.
- **Participant (Event deltagare):** read-only access to event info plus a personal view (bib/category and Race Results link).

External systems:

- **Race Results:** authoritative timing and results, surfaced via embedded links (may be multiple links per participant group).
- **SMS provider:** delivers official invites and announcement notifications. Selected by Frida. No email fallback in v1.

Note: one tenant equals one event in v1, and the tenant name equals the race name.

## MVP scope (in)

1. **Event creation and configuration:** dates, distances, event type, location, facilities, logo, description.
2. **Officials:** registration via SMS invite, management, and assignment scheduling (workstations, to-do lists, timeslots). Scheduling is presented in two complementary, both-editable views over a single assignment model: a **per-person view** (people as columns, timeslots as rows) to read how loaded each official is, and a **per-workstation view** (workstations/to-do as columns, timeslots as rows) to read whether each post is sufficiently staffed against its required headcount. Editing in one view updates the other. The scheduling granularity (the configurable timeslot length) is set per event (1 hour is the Viadal default).
3. **Participant view:** event info, facilities, location, schedule, and Race Results links, plus a personal view showing their own bib/category and a link to their Race Results page.
4. **Results tracking:** via embedded Race Results links. No in-house timing logic.
5. **Communication:** two separate announcement channels (participants and officials), admin-publish only, with SMS notifications on by default and opt-out in personal account settings. (Planned for a later version, not v1: per-workstation channels and two-way/interactive officials messaging with an admin "important" checkbox that triggers SMS.)
6. **System admin layer:** tenant management, activation/deactivation, feature toggling per tenant.
7. **Personal account view** for all authenticated users: mobile number, name, schedule (officials), bib/category and Race Results link (participants), notification settings.

Cross-cutting, non-negotiable from day one: multi-tenant isolation; i18n architected with i18next or equivalent (English default and only language in v1, no hardcoded UI strings); feature-toggle infrastructure per tenant for standard/premium/professional tiers (only one tier active in v1).

## Out of scope for v1 (post-MVP)

- Visitor role (unauthenticated public access).
- Multiple events per tenant.
- Tenant admin count limitations (no limit in v1; introduced with premium tiers).
- Satellite map view.
- Merch and promo partners.
- Open or interactive (two-way) chat channels. v1 has admin-publish-only announcement channels for both participants and officials. Planned for a later version: per-workstation channels and two-way officials messaging with an admin "important" SMS flag.
- Official signup waitlist.
- Tournament event type.
- Email as a communication channel.
- In-house timing or results computation (owned by Race Results).
- C4 model levels 3 and 4.
- Formal card sorting and multi-round user testing (optional in the process).

## Success criteria

- The Viadal 2026 edition is planned and executed on the platform.
- At least one tenant/event is configured by an organizer other than Peter, with no code changes (validates multi-tenancy and the event-neutral model).
- The SMS invite and notification flow works end to end for officials and participants.
- No event-specific, sport-specific, single-tenant, or single-tier assumption is hardcoded anywhere in the data model or UI.

## Key constraints and decisions

- **Stack:** React + TypeScript, fullstack. Patterns chosen to suit Claude Code-assisted development.
- **Team:** two people. Scope stays pragmatic; complexity disproportionate to the team is flagged and avoided.
- **Deadline:** the Viadal 2026 edition.
- **SMS provider** selected by Frida; no email fallback in v1.
- **Multi-tenant**, **i18n-ready**, and **per-tenant feature toggling** are the three non-negotiable architectural requirements.
- **UI delivery** (decided 2026-06-24): one responsive codebase, no separate apps. Admin screens are **web-first** (designed for desktop; still reachable on mobile in a non-optimized, view-heavy way). Official and participant screens are **mobile-first**. Navigation is role-based. The scheduling matrix is edit-on-desktop and view-only on mobile. The official's "My schedule" and the admin scheduler are separate views, not a shared component.

## Domain vocabulary

Aligned to the project instructions and kept event-neutral so the multi-tenant promise is not narrowed to running.

- **Tenant:** one organizer's single event in v1. Tenant name equals race name.
- **Event** → **Stage/Day** → **Venue** (course, route, pool, etc.): structure and where it happens. Event type is a configured attribute.
- **Workstation:** a staffed post or location where officials work (timing point, aid station, lane judge position, finish line). Carries an "up to X" capacity ceiling (a maximum for the day, not a per-timeslot minimum) and one or more operating windows. The per-workstation view flags over-capacity; staffing below the ceiling is normal and not flagged. Timeslots outside a workstation's windows are not allocable.
- **To-do list / Task:** units of work tied to a workstation and/or timeslot. May carry a description/instruction and a single-person checkbox semantics (one official, done/not done).
- **Timeslot:** a scheduled time window for an assignment. Its length is set by the event's scheduling granularity (e.g. 1 hour). A single timeslot can hold multiple parallel workstations and to-dos.
- **Scheduling granularity:** the configurable length of a timeslot (e.g. 30 min, 1 hour), set per event. The scheduling grid's time rows/columns follow it. (UI label: "Scheduling granularity"; formerly "timeslot unit".)
- **Assignment:** an Official mapped to a workstation or to-do and a timeslot. Each person-timeslot cell has a status: assigned, available ("on call"/free), on break, or blocked/unavailable. Both schedule views are pivots of this one model.
- **Official, Participant:** people; see Actors.
- **Channel:** a communication stream. v1 has two announcement channels (participants and officials), admin-publish only. Later versions add per-workstation channels and two-way officials messaging with an admin "important" flag for SMS.
- **Result:** external, accessed via Race Results links.
