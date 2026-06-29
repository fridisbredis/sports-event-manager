# User Flow: Work Area & Checklist Configuration

**Use case:** A tenant admin creates the work areas for an event and configures their parameters and checklists/to-dos, so that officials can later be scheduled against them and know what to do once on post.
**Version:** v0.2 · **Date:** 2026-06-29 · **Owner:** Peter Thorn

> v0.2 changes (Stage model): "workstation" renamed **work area**; each work area now **belongs to exactly one stage**; operating windows must fall within the stage's allocable range (Race = formal start/end ±1h; Non-race = stage start/end). Screen IDs WS-01/WS-02 kept stable; file kept as `workstation-checklist-config.md` for reference stability.

Work areas are the units of work officials are assigned to. They may be physical posts (timing point, aid station / depå, finish line) or non-physical work (social media, purchasing). Each work area belongs to exactly one **stage** (see event-creation-config), so the same kind of work in two stages (e.g. social media in setup and in teardown) is two separate work areas. They are configured before scheduling, because the scheduling flow assigns officials *into* work areas and timeslots. To-do lists / tasks are units of work tied to a work area, optionally carrying instruction text and single-person done/not-done semantics.

## What gets configured

Per work area:

- **Stage:** the single stage this work area belongs to.
- **Identity:** name, optional short description/location note.
- **Operating windows (one or more):** the time window(s) when the work area can be staffed. A work area is not limited to a single continuous range. DECISION (Peter 2026-06-24): a work area may have **multiple discrete windows**. Examples: Depå has one window 08:00–18:00; Toa-området has three windows (a check at 07:00, 12:00, and 18:00). Windows must fall within the stage's **allocable range**: for a **Race** stage that is the formal start/end **extended by up to one hour before and one hour after**; for a **Non-race** stage it is the stage's start/end. Allocation is only possible inside a window (see hard-block below).
- **Capacity:** a single **"up to X"** headcount ceiling for the whole stage. DECISION (Peter 2026-06-24): this is a ceiling, not a per-timeslot minimum. Setting Depå to "up to 3" means you may staff up to 3 in any timeslot. Allocating 1 at night and 3 around lunch is intended and correct, and is **not** flagged as under-staffed. Only exceeding the ceiling is flagged.
- **Checklists / to-dos:** the tasks tied to this work area. Each to-do may carry instruction text and single-person checkbox semantics (one official, done / not done).

## Admin flow: creating work areas

1. Admin opens Work areas for the event.
2. Adds a work area, picks its **stage**, and sets its identity, one or more operating windows (within the stage's allocable range), and capacity ("up to X").
3. Adds the work area's to-dos / checklist items, each with optional instruction text.
4. Repeats for each post (Depå, Tidtagning, etc.), under the appropriate stage.
5. Saves. Work areas and their to-dos are now available to the scheduling flow.

## Admin flow: editing later

1. Admin can edit a work area's stage, capacity, window, or checklists at any time.
2. Lowering capacity below what is already allocated in some timeslot, shrinking the operating window across existing assignments, or moving a work area to a stage whose range no longer covers its windows, affects the schedule. The scheduling view should surface the resulting over-capacity/out-of-window cells rather than silently dropping assignments. (Detail handled in the scheduling revision.)

## Relationship to scheduling (capacity semantics)

- A work area's timeslots **outside all of its operating windows are not allocable** and are disabled in the grid. DECISION (Peter 2026-06-24): allocation outside a window is **hard-blocked** (refused, not a warning), since there is never a reason to staff a work area when it is closed. This differs from the over-capacity rule, which warns but allows.
- Within a window, a cell shows **assigned vs ceiling**, e.g. 1/3.
- Below the ceiling is normal and unflagged (no minimum / no under-staffed flag).
- At the ceiling is full. Exceeding the ceiling is **allowed but warned** (over-capacity warning, not blocked). DECISION (Peter 2026-06-24).

## Notes and open questions

- **Per-window capacity?** The "up to X" ceiling currently applies to the work area whenever it is open. If a work area ever needs different ceilings in different windows, capacity would move from the work area to each window. Not needed for the known cases (Depå, Toa); flagged in case a future event needs it.
- **Checklist scope:** v1 keeps to-dos at the work area level. The vocabulary also allows to-dos tied to a specific timeslot; deferred unless a flow needs it.
- **Checklist completion tracking:** DECISION (Peter 2026-06-24): in **v1 the checklist is purely informational** for the official (no stored completion, no admin readiness view). Planned for a later version: a per-work-area (or per-checklist) setting to choose whether a checklist is **mandatory check-off per work pass** or just informational. When that lands it must sit behind the feature-toggle layer so a tier can gate it, and it needs the completion-tracking and readiness-view model defined.
- **Cross-cutting:** all work area names, to-do text, and labels are i18n strings (English only in v1, no hardcoded UI strings). All work area and to-do data is tenant-scoped. Capacity and checklist behaviour are configuration, not hardcoded variants.
