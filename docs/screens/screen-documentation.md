# Developer-ready Screen Documentation (pipe format)

**Version:** v0.4 · **Date:** 2026-06-29 · **Owner:** Peter Thorn
**v0.4 changes (Stage model):** EVT-02 gains a **stages** section (list + type-aware add/edit modal + read-only expander; Race / Non-race; Race carries distances + formal start/end); "Workstations" relabelled **Work areas** (IDs WS-01/WS-02 kept stable), each work area belongs to one stage and its windows sit within the stage's allocable range (Race = formal time ±1h); SCHED-01 gains a **stage selector** and a "By work area" view; mandatory-to-publish is now name + at least one Race stage; INFO-01 shows only Race stages to participants.
**v0.3 changes (from Claude Design feedback):** "timeslot unit" → "scheduling granularity" (EVT-02); SYS-02 feature tier is single-select / mutually exclusive (exactly one active in v1); SCHED-01 cell semantics clarified and double-booked flag distinct from over-capacity; EVT-01/EVT-02 publish-block rendering split (dashboard checklist vs inline errors); OFF-01 removal is a confirmation modal.
**Process step:** 4 (developer-ready screen docs, pipe format from "Från Idé till App"). Feeds step 5 (lo-fi wireframes via Claude Design).
**Scope this round:** system admin, event admin (race admin), official. Participant screens are deferred until their flows are written.
**Source:** generated from docs/ia/screen-map.md and docs/flows/*. No screens, blocks, functions, or states were invented beyond that source; gaps are listed under OKLARHETER.
**Note on language:** section keywords follow the PDF format (Swedish: SKÄRMAR ATT GENERERA / FLÖDE / OKLARHETER); screen content is in English to match the codebase and v1 UI language.

ID pattern: FLÖDESKOD-LÖPNUMMER. Format per row: `ID | Screen name | Purpose (one line) | Blocks top-to-bottom, comma-separated | States`.

```
SKÄRMAR ATT GENERERA:

AUTH-01 | Sign in | Phone/OTP sign-in for all roles | App name/logo, mobile number input, request-code action, OTP code input, verify action | code-requested, invalid-code, error
AUTH-02 | Invite confirmation | Invited official verifies number and confirms availability to become Confirmed | Verify mobile number, confirm availability, set name, notification default note, complete action | link-valid, link-invalid-or-expired, completed

SYS-01 | Tenant management | System admin lists and manages all tenants across the platform | Tenant list with status, create-tenant action, per-tenant activate/deactivate control | tenant-active, tenant-inactive
SYS-02 | Tenant detail | System admin activates/deactivates a tenant and sets its feature tier | Tenant identity, activation toggle, feature tier (single-select: standard / premium / professional, mutually exclusive) | active, inactive, exactly-one-tier-active-v1 (mutually exclusive; UI is single-select, not independent toggles)

EVT-01 | Event dashboard | Event admin home: status overview of the tenant's single event plus entry to all admin areas | Event summary (name, type, dates, draft/published status), publish status + action (if draft: read-only checklist of missing required fields + disabled Publish), officials status (invited vs confirmed counts), scheduling warnings (over-capacity and double-booked counts), navigation (event config, work areas, officials, scheduling, communication, personal account) | draft, published, publish-blocked-until-name+race-stage (dashboard = read-only missing-field checklist + disabled Publish), warnings-present, no-warnings
EVT-02 | Event configuration | Event admin configures the event facts and publishes it | Identity (name, type, logo, description), dates/duration, stages (list of stages + add/edit action opening a type-aware modal + read-only per-row expander; modal common fields = name, type [Race/Non-race], start/end time, optional venue; Race-only = distance(s) + formal start/end), facilities, scheduling granularity, save, publish | draft-editable, published-editable, publish-requires-name+race-stage (EVT-02 = inline field errors), no-race-stage-blocks-publish, stage-modal-race, stage-modal-non-race, publish-exposes-officials-and-participants, edit-after-publish-out-of-scope-v1

WS-01 | Work areas | Event admin lists the event's work areas | Work area list (name, stage, operating-windows summary, capacity), add-work-area action | filled, empty
WS-02 | Work area configuration | Event admin configures one work area and its checklists | Stage (select), identity (name, description), operating windows (one or more, within the stage's allocable range), capacity ("up to X"), checklists/to-dos (instruction text), save | filled

OFF-01 | Officials roster | Event admin adds/removes officials and sends SMS invites | Officials list with state, add official (name, mobile number), send/re-send invite action, remove action | invited, confirmed, removed, removal-warns-freed-assignments (rendered as a confirmation modal)

SCHED-01 | Scheduling | Event admin builds the schedule over one assignment model in two views, scoped per stage | Stage selector, view toggle (by person / by work area), time range (follows selected stage), assignment grid (by-work-area cell = assigned/ceiling count e.g. 4/6; by-person cell = work area name, no count), conflict/over-capacity/double-booked flags, save | stage-selected, by-person, by-work-area, out-of-window-cell-disabled, over-capacity-warning, double-booked-flag (distinct from over-capacity), edit-on-desktop, view-only-on-mobile

COMM-01 | Communication | Event admin publishes announcements to two separate channels | Channel selector (participants / officials), announcement composer, publish action, channel timeline | participant-channel, officials-channel

ACCT-01 | Personal account | Signed-in user views and manages their own account | Name (editable), mobile number (read-only), notification settings (SMS opt-out), schedule section (conditional: shown when user has assignments, incl. admins) | notifications-on, notifications-off, schedule-section-shown, schedule-section-hidden

HOME-01 | Official home | Official landing; entry to their screens | Navigation (event info, my schedule, announcements, personal account) | (none specified)
INFO-01 | Event info | Official reads the read-only facts about the event | Identity (name, logo, type, description), dates by stage, location/venue per stage, facilities, event programme by stage, Race Results links | read-only, published-only, officials-see-all-stages, participants-see-race-stages-only
MYSCH-01 | My schedule | Official reads their own assignments in two views | View toggle (time / work area), time view (chronological assignments, across stages), work area view (assignments grouped per work area with checklist), read-only | time-view, work-area-view, read-only, mobile-first
ANN-01 | Announcements | Official reads the officials announcement channel | Announcement timeline (read-only) | read-only


FLÖDE:

Sign in (all roles): AUTH-01
System admin tenant management: AUTH-01 → SYS-01 → SYS-02
Event creation & configuration: AUTH-01 → EVT-01 → EVT-02
Work area & checklist configuration: EVT-01 → WS-01 → WS-02
Officials management & registration: EVT-01 → OFF-01 → AUTH-02 → HOME-01
Officials scheduling (admin builds): EVT-01 → SCHED-01
Officials scheduling (official reads): HOME-01 → MYSCH-01
Communication (admin publishes): EVT-01 → COMM-01
Communication (official reads): HOME-01 → ANN-01
Event info (official): HOME-01 → INFO-01
Official personal account: HOME-01 → ACCT-01
Admin personal account: EVT-01 → ACCT-01


OKLARHETER:

OPEN: Inga.

RESOLVED (Peter 2026-06-24):
- EVT-01 (Event dashboard): defined in a dedicated session. Purpose = status overview + navigation. Blocks: event summary, publish status + action, officials status (invited vs confirmed), scheduling warnings (over-capacity, double-booked), navigation to admin areas. (Not included for v1: latest-announcements summary, work areas overview, quick-action shortcuts; can be added later if wanted.)
- UI delivery wording: the previously locked decision stands (admin web-first; official/participant mobile-first; scheduler edit-on-desktop/view-on-mobile). Peter confirmed his "everything mobile-first" recollection was mistaken. No doc/memory changes needed; no per-screen platform tag added.
- AUTH-01 (Sign in): reuse the sign-in design Frida recently built for "Nattvandrarna". If Frida wants to deviate from it, she checks with Peter first.
- EVT-02 (mandatory publish fields, updated 2026-06-29): name and at least one Race stage (a Race stage carries its own start/end, satisfying the date requirement). Reflected in EVT-01/EVT-02 publish states.
- EVT-02 (publish visibility): publishing exposes the event to officials and participants at the same time (no separate switch). Reflected in EVT-02 states.
- EVT-02 (edit after publish): stays out of v1. Reflected in EVT-02 states.

INFORMATIONAL (no decision needed):
- Participant screens (INFO-01 shared with participants; ACCT-01 participant variant; plus participant home, personal view, participant announcements) are excluded this round pending their flows.
- Already-decided constraints affecting blocks: capacity is "up to X" ceiling (over-capacity warns), operating windows hard-block outside hours, checklist informational in v1, number read-only in v1, single SMS opt-out in v1, drop-out is admin-mediated.
```
