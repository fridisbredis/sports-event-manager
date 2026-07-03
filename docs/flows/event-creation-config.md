# User Flow: Event Creation & Configuration

**Use case:** A tenant admin creates an event and configures the facts about it (what it is, when, where, and what facilities exist), then publishes it so officials and participants can see it.
**Version:** v0.3 · **Date:** 2026-07-01 · **Owner:** Peter Thorn

> v0.3 changes (2026-07-01, from a working session with Frida): **Facilities** are now a proper add-and-list feature (typed entries saved to a per-event facilities table), see "Facilities" below. Added a cross-cutting **unsaved-changes guard** note. Both decisions apply to EVT-02.
> v0.2 changes (Stage model): structure is now Event → Stage → Work area. A stage has a type (Race / Non-race), its own start/end time, and an optional venue. Distances move onto Race stages. Mandatory-to-publish is "at least one Race stage". Stages are managed inside event configuration (EVT-02) via a list + type-aware add/edit modal + read-only expander.

In v1 one tenant equals one event, and the tenant name equals the race name. So "creating the event" is effectively configuring the tenant's single event. The model is kept event-neutral: event type is a configured attribute, not a hardcoded variant, so a swim meet and Viadal are the same model with different configuration.

## What gets configured

Grounded in scope item 1 (dates, distances, event type, location, facilities, logo, description).

- **Identity:** event/race name (equals tenant name), event type (configured attribute), logo, description.
- **When:** the event spans the union of its stages' start/end times. Viadal is a 6-day event, so its Race stage holds a date range, not a single date.
- **Structure:** Event → **Stage** → **Work area**. An event is configured as one or more **stages**, each with a **type** (Race or Non-race), its own start and end time, and an optional **venue** (course, route, pool, etc.). A **Race** stage is participant-facing and carries one or more distances (in time or distance) and a formal start/end time. A **Non-race** stage is officials/admin-only operational work (setup, teardown, reporting, social media) and is not shown to participants. v1 requires **at least one Race stage**. Viadal 6-day is one Race stage spanning six days; a multi-segment competition (e.g. a stage race) is several Race stages. The UI pre-fills three template stages (setup, race, teardown), all editable and removable down to the one-Race-stage minimum.
- **Distances:** configured on each **Race stage** (event-neutral, in time or distance). Any event-level distance display is a read-only roll-up of the Race stages' distances.
- **Where:** location and venue details.
- **Facilities:** the facilities available at the event (the list participants and officials will later see). **DECISION (2026-07-01):** facilities are an add-and-list feature. The admin types a facility name (e.g. "Toilet") into an add-field and saves it; each saved facility becomes an entry in a per-event **facilities** table and appears in a list below the add-field. Entries can be added and removed. **Scope:** facilities are **event-level** in v1 (one list for the whole event, tenant-scoped), which matches Viadal's single Race stage. The data model is kept open so facilities could later be scoped per stage without a rewrite; per-stage facilities are **not** a committed plan. Each facility is a first-class entry (not free text on the event) so later phases can build on it (e.g. attach to a stage/venue, add type/icon, show on a map).
- **Scheduling granularity:** the configurable timeslot length (1 hour is the Viadal default), set per event. Configured here so it is in place before scheduling begins. (Confirmed/used again at the start of the scheduling flow.) Formerly called "timeslot unit".

## Admin flow: creating and configuring

1. Admin signs in and opens their event (the tenant's single event). On first use the event exists as a **draft** shell created when the tenant was provisioned by the system admin.
2. Admin fills in identity (name, type, logo, description).
3. Admin adds the **stages**. Each stage is created/edited in a type-aware modal: common fields (name, type, start/end time, optional venue), plus Race-only fields (distance(s); the start/end is the formal race clock). The stage list shows all stages, default-sorted by start time, with a read-only expander per row for its details. (Work areas are attached to stages later, on the Work areas screens.)
4. Admin adds distances and facilities.
5. Admin sets the scheduling granularity (default 1 hour).
6. Admin saves. The event can be saved incomplete and returned to; nothing is shared with officials or participants while it is a draft.

## Admin flow: publishing / activating

1. When the core facts are in place, admin **publishes** the event.
2. Publishing moves it from **draft** to **published**, the state in which officials and participants can see event info and their personal views.
3. Admin can keep editing a published event; changes are reflected in the views. (No approval workflow in v1.)

## State model

- **Draft:** being configured, visible to admins only.
- **Published:** visible to officials and participants per their role.

This is distinct from tenant **activation/deactivation**, which is the system admin's control over the whole tenant. A deactivated tenant's event is not reachable regardless of draft/published state.

## Notes and open questions

- **Minimum to publish (DECISION 2026-06-29):** name, and **at least one Race stage**. A Race stage carries its own start/end time, so this also satisfies the "at least one date" requirement. Reflected in EVT-01/EVT-02 publish states.
- **Work area buffer (DECISION 2026-06-29):** a work area's operating windows must fall within its stage's allocable range. For a Race stage that range is the formal start/end extended by up to one hour before and one hour after (pre-start assembly, post-finish measurement); for a Non-race stage it is the stage's start/end. Fixed v1 rule; may become configurable later behind a feature toggle.
- **Officials vs participants visibility on publish:** publishing currently exposes the event to both roles at once. If admins need to onboard officials before participants see anything, we may need two visibility switches. Flagged, not decided.
- **Edit-after-publish side effects:** changing dates or the scheduling granularity after scheduling has begun affects existing assignments. Out of scope to fully model now; flag for the scheduling revision.
- **Unsaved-changes guard (DECISION 2026-07-01):** the screen saves via an explicit **Save** button; edits made in the page's modals are not persisted until Save is clicked. If the admin tries to navigate away (change page/view) with unsaved changes, the app intercepts and shows a confirmation dialog offering **Save**, **Discard and continue** (leave without saving), and **Cancel** (stay). This is a cross-cutting pattern that applies to every edit screen with a Save button (EVT-02, WS-02, and later SCHED-01, ACCT-01, COMM-01); see `docs/screens/screen-documentation.md` for the shared spec.
- **Cross-cutting:** all field labels, type names, and facility labels are i18n strings (English only in v1, no hardcoded UI strings). All event data is tenant-scoped. Event type, facilities, and the draft/published mechanics are configuration, not hardcoded variants, so nothing here narrows the multi-tenant or feature-toggle promise.
