# User Flow: Officials Scheduling

**Use case:** A tenant admin schedules officials against workstations, to-dos, and timeslots for an event, and an official reads their own resulting schedule.
**Version:** v0.3 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

> v0.2 changes: capacity is an "up to X" ceiling (not a minimum); the grid is operating-window-aware (cells outside a station's windows are hard-blocked); only Confirmed officials are schedulable; the official reads their own schedule in two views. These align with workstation-checklist-config and officials-management-registration.
> v0.3 changes: "timeslot unit" renamed to "scheduling granularity"; cell semantics clarified (by-workstation = assigned/ceiling count, by-person = workstation name, no count); double-booked is a distinct flag from over-capacity.

Grounded in two real Viadal schedules: a per-person matrix (people as columns, hours as rows) and a per-workstation day schedule (stations/tasks as columns, hours as rows). Both are pivots of the same assignment data; the tool must offer both rather than forcing one.

## Core model (shared by both views)

One assignment record = { official, workstation-or-to-do, timeslot, status }.

- **Scheduling granularity** (the timeslot length) is configured per event (1 hour is the Viadal default); the grid's time rows follow it. A single timeslot can hold multiple parallel workstations and to-dos. (Formerly "timeslot unit".)
- **Workstation capacity** is an **"up to X" ceiling** for the whole day, not a per-timeslot minimum (e.g. Depå up to 3). Staffing below the ceiling is normal and never flagged as under-staffed; only exceeding it is flagged. See workstation-checklist-config.
- **Operating windows** belong to the workstation (one or more discrete windows per day). Timeslots outside all of a station's windows are not allocable and are disabled/hard-blocked in the grid.
- **Schedulable officials:** only **Confirmed** officials appear in the grid (they have verified their number and confirmed availability). **Admins are always schedulable** and appear automatically as the first staff member (implicitly Confirmed). See officials-management-registration.
- **Person-timeslot status:** assigned · available (free / "on call") · on break · blocked-unavailable (e.g. worked the night before).
- Both views read and write this one model. Editing in either view updates the other.

## Admin flow: building the schedule

1. Admin opens Scheduling for the event. Chooses or confirms the scheduling granularity and the schedule's time range.
2. Admin picks a view via a toggle: **By person** or **By workstation**. The toggle is persistent and the default is remembered.
3. Admin assigns work:
   - In **By workstation** view: pick a workstation/to-do column and a timeslot row, add officials into that cell. The cell shows assigned-vs-ceiling (e.g. 1/3). Cells outside the station's operating windows are disabled and cannot receive an assignment.
   - In **By person** view: pick a person column and a timeslot row, set the cell to a workstation/to-do or to a status (break, blocked). The column makes that person's total load visible at a glance.
4. The system surfaces conflicts and gaps continuously:
   - A person assigned to two places in the same timeslot is flagged.
   - A blocked/unavailable person cannot be assigned; attempting it warns the admin.
   - Assigning a station beyond its "up to X" ceiling in a timeslot is **allowed but warned** (over-capacity). Staffing below the ceiling is normal and not flagged.
   - Assigning a station outside its operating windows is **hard-blocked** (the cell is not allocable), since there is no reason to staff a closed post.
5. Admin attaches to-do detail where needed (instruction text, single-person checkbox semantics).
6. Admin saves. Changes are immediately reflected in both views.

## Admin flow: reviewing readiness

1. From either view, admin scans for flags: over-capacity cells, double-booked people, and unintended idle/blocked people. (There is no under-staffed flag, since capacity is a ceiling, not a minimum; the admin judges coverage against each station's windows.)
2. Admin switches view to cross-check: the per-workstation view answers "is each post staffed as intended within its windows, and is anyone over the ceiling?", the per-person view answers "is anyone over- or under-loaded?".
3. When satisfied, the schedule is the source of truth for each official's personal schedule.

## Official flow: reading own schedule (where it differs)

A Confirmed official reads their own schedule in **two views** over their own assignments (the same one model, scoped to them):

1. Official signs in and opens their schedule from their personal account.
2. **Time view:** their assignments in chronological order (what they are doing at each timeslot), so they can read their day top to bottom.
3. **Workstation view:** their assignments grouped per workstation/to-do, with that station's checklist/instruction text shown alongside, so they can see everything tied to each post they cover.
4. They see only their own data: no cross-tenant or other-official data.
5. They do not edit assignments. (Self-service swaps/waitlist are post-MVP.)

## Notes and open questions

- **Allocation unit beyond time:** Peter raised that the controlling unit might be something other than the hour. v1 keeps it as a configurable timeslot length; non-time units (e.g. per-lap, per-shift block) are not modelled in v1 unless a future event needs them.
- **Bulk assignment** (assign a person to a recurring workstation across many timeslots in one action) is desirable but not yet specified; flag for the screen doc.
- **UI delivery (DECISION 2026-06-24):** the scheduling matrix is **edit-on-desktop, view-only on mobile**. Admins build and change the schedule on desktop (web-first); on mobile the schedule is read-only (e.g. an admin checking a station's coverage on site). This is the one screen that drives the web-first/mobile-first split; see docs/ia/screen-map.md. The official's read-only "My schedule" is a separate, mobile-first view/component, not the same component as this admin matrix.
- **Multi-tenant / i18n / feature-toggle:** all column headers, status labels, and view names are i18n strings; all data is tenant-scoped; the two-view scheduler is a togglable capability so a future tier could gate one view.
