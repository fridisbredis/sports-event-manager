# Claude Design wireframe prompts (adapted)

**Version:** v0.3 · **Date:** 2026-06-29 · **Owner:** Peter Thorn
**v0.3 changes (Stage model):** EVT-02 gains a **stages** section (list + type-aware add/edit modal + read-only expander; Race / Non-race); "Workstations" relabelled **Work areas** (IDs WS-01/WS-02 kept stable), each work area picks its stage; SCHED-01 gains a **stage selector** and a "By work area" view; INFO-01 shows dates/venue/programme by stage (participants see only Race stages). Only the affected screens (EVT-01, EVT-02, WS-01, WS-02, SCHED-01, INFO-01, MYSCH-01) need regenerating.
**Add-on (2026-07-02):** OFF-01 (Officials roster) was missing from the "EventAdmin_view v2" Claude Design document because the Stage-model delta re-run only regenerated the Stage-affected screens. Use the **ADD-ON RUN — OFF-01** at the bottom of this file to append it to that document without regenerating the existing frames.
**v0.2 changes (post first Claude Design run):** "timeslot unit" → "scheduling granularity"; SYS-02 feature tier is single-select / mutually exclusive; SCHED-01 cell semantics + double-booked flag clarified; INFO-01 Race Results links marked external. Re-run is only needed if you want the wireframes regenerated to match.
**Purpose:** ready-to-paste prompts for step 5 (lo-fi wireframes), adapted from the "Från Idé till App" prompt. Two runs because our UI-delivery decision splits the app into a **mobile-first official shell** and a **web-first admin shell**. Screens and flows are filled from `docs/screens/screen-documentation.md`.

Notes:
- Written in English to match the codebase and v1 UI language.
- Sign in (AUTH-01) is **not** generated: it reuses Frida's "Nattvandrarna" sign-in design. It is omitted from the flow chains below; assume every authenticated flow starts after AUTH-01.
- Known gap to revisit (not for this run): the scheduler on mobile is view-only per the UI-delivery decision, but no read-only mobile schedule screen is defined yet (an admin checking a station's coverage on site). SCHED-01 is wireframed as the desktop editing screen only. Flag for a later round.
- The strict rules from the original prompt are kept (grayscale, no invented screens/blocks, ask if unclear, states as separate frames).
- Run each prompt separately in Claude Design. Resolve any questions it returns before accepting the output.

---

## RUN 1 — Mobile (official) screens

```
Create lo-fi wireframes for the MOBILE views of a single responsive WEB app (viewed in a phone browser). This is not a native mobile app and not a separate product; it is the same web app, optimized for a small screen for this role. Strict rules.

STYLE
- Grayscale only: white background, grey outlines (#999), dark grey text (#333), light grey fills (#E5E5E5) for placeholders.
- No colors, no shadows, no gradients, no detailed icons. Use simple geometric placeholders (crossed rectangle for image, circle for avatar, dashed lines for body text).
- Use the REAL labels I give in the blocks (e.g. "By person / By work area"). Use placeholder text only for free-form body content ("Body line 1").
- No logic, no interactions, no functional code. Static visual layout only.
- Mobile format 375 × 812 px, one screen per frame.

CONTENT
- Generate EXACTLY the screens I list. Do not invent extra screens or add features not mentioned. If anything is unclear, ask before generating.
- Each screen shows: the screen name and ID above the frame; the navigation element; the layout blocks in the given top-to-bottom order; and each state I list as a SEPARATE frame.
- Navigation for this shell: a bottom tab bar with Home, My schedule, Event info, Announcements, Account. Exception: AUTH-02 is pre-auth, so it has no tab bar, just its content and a single primary action.

SKÄRMAR ATT GENERERA:
AUTH-02 | Invite confirmation | Invited official verifies number and confirms availability to become Confirmed | Verify mobile number, confirm availability, set name, notification default note, complete action | states: link-valid (filled), link-invalid-or-expired (error), completed (success)
HOME-01 | Official home | Official landing; entry to their screens | Navigation (event info, my schedule, announcements, personal account) | states: filled
INFO-01 | Event info | Official reads the read-only facts about the event | Identity (name, logo, type, description), dates by stage, location/venue per stage, facilities, event programme by stage, Race Results links (external; open external web pages; use an external-link glyph, not an in-app chevron) | states: filled (read-only)
MYSCH-01 | My schedule | Official reads their own assignments in two views | View toggle (time / work area), time view (chronological assignments), work area view (assignments grouped per work area with checklist), read-only | states: time-view, work-area-view, empty (no assignments)
ANN-01 | Announcements | Official reads the officials announcement channel | Announcement timeline (read-only) | states: filled, empty (no announcements)
ACCT-01 | Personal account (official) | Official views and manages their own account | Name (editable), mobile number (read-only), notification settings (SMS opt-out), schedule section (shown when the user has assignments) | states: notifications-on, notifications-off, schedule-section-shown (has assignments), schedule-section-hidden (no assignments)

FLÖDE:
Officials registration (tail): AUTH-02 → HOME-01
Officials scheduling (official reads): HOME-01 → MYSCH-01
Communication (official reads): HOME-01 → ANN-01
Event info (official): HOME-01 → INFO-01
Official personal account: HOME-01 → ACCT-01

End with a section "OKLARHETER:" listing anything I must clarify before this is usable. If none, write "Inga".
```

---

## RUN 2 — Web (admin) screens

```
Create lo-fi wireframes for the DESKTOP views of a single responsive WEB app (viewed in a computer browser). This is the same web app as the mobile views in the other run, optimized for a large screen for this role. Strict rules.

STYLE
- Grayscale only: white background, grey outlines (#999), dark grey text (#333), light grey fills (#E5E5E5) for placeholders.
- No colors, no shadows, no gradients, no detailed icons. Use simple geometric placeholders (crossed rectangle for image, dashed lines for body text).
- Use the REAL labels I give in the blocks. Use placeholder text only for free-form body content.
- No logic, no interactions, no functional code. Static visual layout only.
- Desktop format 1440 × 1024 px, one screen per frame.

CONTENT
- Generate EXACTLY the screens I list. Do not invent extra screens or add features not mentioned. If anything is unclear, ask before generating.
- Each screen shows: the screen name and ID above the frame; the navigation element; the layout blocks in the given top-to-bottom order; and each state I list as a SEPARATE frame.
- Navigation for this shell: a LEFT SIDEBAR. For event-admin screens the sidebar items are Dashboard, Event configuration, Work areas, Officials, Scheduling, Communication, Account. The two system-admin screens (SYS-01, SYS-02) are a separate top-level context with a sidebar item "Tenants" only.
- SCHED-01 is a desktop editing screen (dense matrix). Give it the full width.

SKÄRMAR ATT GENERERA:
SYS-01 | Tenant management | System admin lists and manages all tenants | Tenant list with status, create-tenant action, per-tenant activate/deactivate control | states: filled (rows showing active and inactive tenants), empty (no tenants)
SYS-02 | Tenant detail | System admin activates/deactivates a tenant and sets its feature tier | Tenant identity, activation toggle, feature tier (single-select: standard / premium / professional, mutually exclusive) | states: active, inactive, exactly-one-tier-active-v1 (single-select, not independent toggles)
EVT-01 | Event dashboard | Event admin home: status overview plus entry to admin areas | Event summary (name, type, dates, draft/published status), publish status + action (if draft: publish action and missing required fields), officials status (invited vs confirmed counts), scheduling warnings (over-capacity and double-booked counts), navigation to admin areas | states: draft, published, publish-blocked-until-name+race-stage, warnings-present, no-warnings
EVT-02 | Event configuration | Event admin configures the event facts and publishes it | Identity (name, type, logo, description), dates/duration, stages section (a list of stages each showing name + type [Race/Non-race] + start/end + an expand arrow that opens a read-only details row beneath it; an "add stage" action; rows have edit/delete), facilities, scheduling granularity, save, publish | states: draft-editable, published-editable, publish-blocked-until-name+race-stage (rendered as inline field errors), no-race-stage (publish disabled), stages-list-collapsed, stages-list-one-row-expanded (read-only details: venue, and for Race the distance(s) + formal start/end), add-edit-stage-modal-race (fields: name, type=Race, start/end time, venue, distance(s)), add-edit-stage-modal-non-race (fields: name, type=Non-race, start/end time, venue). Behavioral rules (not separate frames): the add/edit modal is type-aware (distance + formal-clock fields appear only for Race); publishing exposes officials and participants simultaneously; editing dates/scheduling-granularity after publish is out of scope in v1.
WS-01 | Work areas | Event admin lists the event's work areas | Work area list (name, stage, operating-windows summary, capacity), add-work-area action | states: filled, empty (no work areas)
WS-02 | Work area configuration | Event admin configures one work area and its checklists | Stage (select), identity (name, description), operating windows (one or more), capacity ("up to X"), checklists/to-dos (instruction text), save | states: filled
OFF-01 | Officials roster | Event admin adds/removes officials and sends SMS invites | Officials list with state, add official (name, mobile number), send/re-send invite action, remove action | states: filled (mix of invited/confirmed), empty (no officials), removal-warning
SCHED-01 | Scheduling | Event admin builds the schedule over one assignment model in two views, scoped per stage | Stage selector, view toggle (by person / by work area), time range (follows selected stage), assignment grid (by-work-area cell = assigned/ceiling count e.g. 4/6; by-person cell = work area name, no count; grid columns follow the configured scheduling granularity), conflict/over-capacity/double-booked flags with legend, save | states: stage-selected, by-person, by-work-area, empty (no assignments), over-capacity-warning, double-booked-flag (distinct from over-capacity), out-of-window-cell-disabled
COMM-01 | Communication | Event admin publishes announcements to two separate channels | Channel selector (participants / officials), announcement composer, publish action, channel timeline | states: participant-channel, officials-channel, empty (no announcements yet)
ACCT-01 | Personal account (admin) | Admin views and manages their own account | Name (editable), mobile number (read-only), notification settings (SMS opt-out), schedule section (admins are schedulable, so shown) | states: notifications-on, notifications-off

FLÖDE:
System admin tenant management: SYS-01 → SYS-02
Event creation & configuration: EVT-01 → EVT-02
Work area & checklist configuration: EVT-01 → WS-01 → WS-02
Officials management: EVT-01 → OFF-01 (then SMS hand-off to mobile AUTH-02)
Officials scheduling (admin builds): EVT-01 → SCHED-01
Communication (admin publishes): EVT-01 → COMM-01
Admin personal account: EVT-01 → ACCT-01

End with a section "OKLARHETER:" listing anything I must clarify before this is usable. If none, write "Inga".
```

---

## Delta re-run — only the screens the Stage model changed

Use these instead of the full runs when you only want to regenerate the screens affected by the Stage model (v0.3). They use the same strict rules and shell context as the full runs, but list only the changed screens. Replace the corresponding old frames with the new output.

Affected screens: **EVT-01, EVT-02, WS-01, WS-02, SCHED-01** (desktop/admin) and **INFO-01, MYSCH-01** (mobile/official). All other screens are unchanged and do not need regenerating.

### DELTA RUN A — Web (admin) changed screens

```
Create lo-fi wireframes for the DESKTOP views of a single responsive WEB app (viewed in a computer browser), optimized for a large screen for the admin role. Strict rules.

STYLE
- Grayscale only: white background, grey outlines (#999), dark grey text (#333), light grey fills (#E5E5E5) for placeholders.
- No colors, no shadows, no gradients, no detailed icons. Use simple geometric placeholders (crossed rectangle for image, dashed lines for body text).
- Use the REAL labels I give in the blocks. Use placeholder text only for free-form body content.
- No logic, no interactions, no functional code. Static visual layout only.
- Desktop format 1440 × 1024 px, one screen per frame.

CONTENT
- Generate EXACTLY the screens I list below and NOTHING else. Do not invent extra screens or add features not mentioned. If anything is unclear, ask before generating.
- Each screen shows: the screen name and ID above the frame; the navigation element; the layout blocks in the given top-to-bottom order; and each state I list as a SEPARATE frame.
- Navigation for this shell: a LEFT SIDEBAR with items Dashboard, Event configuration, Work areas, Officials, Scheduling, Communication, Account.
- SCHED-01 is a desktop editing screen (dense matrix). Give it the full width.

SKÄRMAR ATT GENERERA:
EVT-01 | Event dashboard | Event admin home: status overview plus entry to admin areas | Event summary (name, type, dates, draft/published status), publish status + action (if draft: publish action and missing required fields), officials status (invited vs confirmed counts), scheduling warnings (over-capacity and double-booked counts), navigation to admin areas | states: draft, published, publish-blocked-until-name+race-stage, warnings-present, no-warnings
EVT-02 | Event configuration | Event admin configures the event facts and publishes it | Identity (name, type, logo, description), dates/duration, stages section (a list of stages each showing name + type [Race/Non-race] + start/end + an expand arrow that opens a read-only details row beneath it; an "add stage" action; rows have edit/delete), facilities, scheduling granularity, save, publish | states: draft-editable, published-editable, publish-blocked-until-name+race-stage (rendered as inline field errors), no-race-stage (publish disabled), stages-list-collapsed, stages-list-one-row-expanded (read-only details: venue, and for Race the distance(s) + formal start/end), add-edit-stage-modal-race (fields: name, type=Race, start/end time, venue, distance(s)), add-edit-stage-modal-non-race (fields: name, type=Non-race, start/end time, venue). Behavioral rules (not separate frames): the add/edit modal is type-aware (distance + formal-clock fields appear only for Race); publishing exposes officials and participants simultaneously; editing dates/scheduling-granularity after publish is out of scope in v1.
WS-01 | Work areas | Event admin lists the event's work areas | Work area list (name, stage, operating-windows summary, capacity), add-work-area action | states: filled, empty (no work areas)
WS-02 | Work area configuration | Event admin configures one work area and its checklists | Stage (select), identity (name, description), operating windows (one or more), capacity ("up to X"), checklists/to-dos (instruction text), save | states: filled
SCHED-01 | Scheduling | Event admin builds the schedule over one assignment model in two views, scoped per stage | Stage selector, view toggle (by person / by work area), time range (follows selected stage), assignment grid (by-work-area cell = assigned/ceiling count e.g. 4/6; by-person cell = work area name, no count; grid columns follow the configured scheduling granularity), conflict/over-capacity/double-booked flags with legend, save | states: stage-selected, by-person, by-work-area, empty (no assignments), over-capacity-warning, double-booked-flag (distinct from over-capacity), out-of-window-cell-disabled

FLÖDE:
Event creation & configuration: EVT-01 → EVT-02
Work area & checklist configuration: EVT-01 → WS-01 → WS-02
Officials scheduling (admin builds): EVT-01 → SCHED-01

End with a section "OKLARHETER:" listing anything I must clarify before this is usable. If none, write "Inga".
```

### DELTA RUN B — Mobile (official) changed screens

```
Create lo-fi wireframes for the MOBILE views of a single responsive WEB app (viewed in a phone browser), optimized for a small screen for the official role. Strict rules.

STYLE
- Grayscale only: white background, grey outlines (#999), dark grey text (#333), light grey fills (#E5E5E5) for placeholders.
- No colors, no shadows, no gradients, no detailed icons. Use simple geometric placeholders (crossed rectangle for image, circle for avatar, dashed lines for body text).
- Use the REAL labels I give in the blocks. Use placeholder text only for free-form body content ("Body line 1").
- No logic, no interactions, no functional code. Static visual layout only.
- Mobile format 375 × 812 px, one screen per frame.

CONTENT
- Generate EXACTLY the screens I list below and NOTHING else. Do not invent extra screens or add features not mentioned. If anything is unclear, ask before generating.
- Each screen shows: the screen name and ID above the frame; the navigation element; the layout blocks in the given top-to-bottom order; and each state I list as a SEPARATE frame.
- Navigation for this shell: a bottom tab bar with Home, My schedule, Event info, Announcements, Account.

SKÄRMAR ATT GENERERA:
INFO-01 | Event info | Official reads the read-only facts about the event | Identity (name, logo, type, description), dates by stage, location/venue per stage, facilities, event programme by stage, Race Results links (external; open external web pages; use an external-link glyph, not an in-app chevron) | states: filled (read-only)
MYSCH-01 | My schedule | Official reads their own assignments in two views | View toggle (time / work area), time view (chronological assignments), work area view (assignments grouped per work area with checklist), read-only | states: time-view, work-area-view, empty (no assignments)

FLÖDE:
Event info (official): HOME-01 → INFO-01
Officials scheduling (official reads): HOME-01 → MYSCH-01

End with a section "OKLARHETER:" listing anything I must clarify before this is usable. If none, write "Inga".
```

---

## ADD-ON RUN — OFF-01 (Officials roster) into EventAdmin_view v2

Use this when you only want to **append** the missing Officials roster to the existing "Viadal Wireframes - EventAdmin_view v2" document (which holds EVT-01, EVT-02, WS-01, WS-02, SCHED-01). It does not regenerate any existing frame.

**Decisions baked in:** "Add official" is a **modal** (matches the existing add-stage modal in the same document); removal is a **confirmation modal** that warns it frees the official's assignments (v0.3: `removal-warns-freed-assignments`). Source: OFF-01 in `docs/screens/screen-documentation.md` and RUN 2 above.

```
Add ONE new screen — OFF-01 (Officials roster) — to THIS existing document. Do NOT regenerate, move, restyle, or alter the frames already here (EVT-01, EVT-02, WS-01, WS-02, SCHED-01). Only append the new OFF-01 frames. Place them as a new horizontal row beneath the existing Scheduling (SCHED-01) row, one frame per state, left-aligned to match the existing rows. Strict rules.

STYLE (match the existing frames exactly)
- Grayscale only: white background, grey outlines (#999), dark grey text (#333), light grey fills (#E5E5E5) for placeholders. No colors, no shadows, no gradients, no detailed icons.
- Reuse the exact admin shell already in this document: 1440 × 1024 px frame, a LEFT SIDEBAR with brand block ("Viadal / Event admin") and items Dashboard, Event configuration, Work areas, Officials, Scheduling, Communication, Account. On these OFF-01 frames the active item is "Officials".
- Reuse the existing components and their look: page header row with an H1 and a primary action button; bordered cards; the table header/row style used in WS-01 (Work areas); the pill "badge" used for status; the same modal + scrim style used in EVT-02's add-stage modal; the "empty state" block used in WS-01 empty.
- Use the REAL labels given below. Placeholder text only for free-form body content. No logic, no interactions, no functional code — static layout only.
- Put the screen name and ID above each frame in the same format as the other frames, e.g. "OFF-01 · Officials roster — <state>".

SCREEN
OFF-01 | Officials roster | Event admin adds/removes officials and sends SMS invites | Page header ("Officials") with a primary "Add official" action; officials table with columns Name, Mobile number, Status (badge: Invited / Confirmed), and a per-row actions area (Invited rows show "Re-send invite" + "Remove"; Confirmed rows show "Remove"); the admin's own account appears as the first row, implicitly Confirmed, with no invite action and no Remove | states below, each as a SEPARATE frame.

STATES
1. empty (no officials) — the shell + header, and the WS-01-style empty-state block: placeholder graphic, "No officials yet", one line "Add officials and send them an SMS invite to join.", and an "Add official" button.
2. filled — table with ~6 rows mixing Invited and Confirmed. First row is the admin (e.g. "You — Event admin", Confirmed, no actions). Show a couple of Invited rows (Status = Invited, actions "Re-send invite" + "Remove") and several Confirmed rows (Status = Confirmed, action "Remove"). Mobile numbers as masked placeholders (e.g. +46 70 000 00 00).
3. add-official-modal — the filled table dimmed behind a scrim, with a centered modal titled "Add official" containing: Name field, Mobile number field, a short note "An SMS invite is sent to this number.", and footer buttons "Cancel" (secondary) + "Send invite" (primary). Match the EVT-02 add-stage modal dimensions and styling.
4. removal-confirmation-modal — the filled table dimmed behind a scrim, with a centered confirmation modal titled "Remove official?". Body: "Removing [name] also frees any work-area assignments they hold. This can't be undone." Footer buttons "Cancel" (secondary) + "Remove" (primary/destructive-styled within grayscale, e.g. dark fill).

FLOW (for context; do not draw arrows or extra screens)
Officials management & registration: EVT-01 → OFF-01 → (SMS hand-off to the mobile Invite confirmation screen AUTH-02, which lives in the official/mobile view, not this document).

End with a section "OKLARHETER:" listing anything I must clarify before this is usable. If none, write "Inga".
```
