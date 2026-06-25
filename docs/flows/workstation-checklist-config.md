# User Flow: Workstation & Checklist Configuration

**Use case:** A tenant admin creates the workstations for an event and configures their parameters and checklists/to-dos, so that officials can later be scheduled against them and know what to do once on post.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

Workstations are the staffed posts where officials work (timing point, aid station / depå, lane judge position, finish line). They are configured before scheduling, because the scheduling flow assigns officials *into* workstations and timeslots. To-do lists / tasks are units of work tied to a workstation, optionally carrying instruction text and single-person done/not-done semantics.

## What gets configured

Per workstation:

- **Identity:** name, optional short description/location note.
- **Operating windows (one or more):** the time window(s) during the event when the station can be staffed. A station is not limited to a single continuous range. DECISION (Peter 2026-06-24): a station may have **multiple discrete windows per day**. Examples: Depå has one window 08:00–18:00; Toa-området has three windows (a check at 07:00, 12:00, and 18:00). Allocation is only possible inside a window (see hard-block below).
- **Capacity:** a single **"up to X"** headcount ceiling for the whole event/day. DECISION (Peter 2026-06-24): this is a ceiling, not a per-timeslot minimum. Setting Depå to "up to 3" means you may staff up to 3 in any timeslot. Allocating 1 at night and 3 around lunch is intended and correct, and is **not** flagged as under-staffed. Only exceeding the ceiling is flagged.
- **Checklists / to-dos:** the tasks tied to this workstation. Each to-do may carry instruction text and single-person checkbox semantics (one official, done / not done).

## Admin flow: creating workstations

1. Admin opens Workstations for the event.
2. Adds a workstation and sets its identity, one or more operating windows, and capacity ("up to X").
3. Adds the workstation's to-dos / checklist items, each with optional instruction text.
4. Repeats for each post (Depå, Tidtagning, etc.).
5. Saves. Workstations and their to-dos are now available to the scheduling flow.

## Admin flow: editing later

1. Admin can edit a workstation's capacity, window, or checklists at any time.
2. Lowering capacity below what is already allocated in some timeslot, or shrinking the operating window across existing assignments, affects the schedule. The scheduling view should surface the resulting over-capacity/out-of-window cells rather than silently dropping assignments. (Detail handled in the scheduling revision.)

## Relationship to scheduling (capacity semantics)

- A station's timeslots **outside all of its operating windows are not allocable** and are disabled in the grid. DECISION (Peter 2026-06-24): allocation outside a window is **hard-blocked** (refused, not a warning), since there is never a reason to staff a station when it is closed. This differs from the over-capacity rule, which warns but allows.
- Within a window, a cell shows **assigned vs ceiling**, e.g. 1/3.
- Below the ceiling is normal and unflagged (no minimum / no under-staffed flag).
- At the ceiling is full. Exceeding the ceiling is **allowed but warned** (over-capacity warning, not blocked). DECISION (Peter 2026-06-24).
- This reframes the earlier "required headcount / under-staffed" wording in `officials-scheduling.md` and the scope-doc domain vocabulary, which will be aligned to ceiling semantics when those files are next edited (see scheduling-revision task).

## Notes and open questions

- **Per-window capacity?** The "up to X" ceiling currently applies to the station whenever it is open. If a station ever needs different ceilings in different windows, capacity would move from the station to each window. Not needed for the known cases (Depå, Toa); flagged in case a future event needs it.
- **Checklist scope:** v1 keeps to-dos at the workstation level. The vocabulary also allows to-dos tied to a specific timeslot; deferred unless a flow needs it.
- **Checklist completion tracking:** DECISION (Peter 2026-06-24): in **v1 the checklist is purely informational** for the official (no stored completion, no admin readiness view). Planned for a later version: a per-workstation (or per-checklist) setting to choose whether a checklist is **mandatory check-off per work pass** or just informational. When that lands it must sit behind the feature-toggle layer so a tier can gate it, and it needs the completion-tracking and readiness-view model defined.
- **Cross-cutting:** all workstation names, to-do text, and labels are i18n strings (English only in v1, no hardcoded UI strings). All workstation and to-do data is tenant-scoped. Capacity and checklist behaviour are configuration, not hardcoded variants.
