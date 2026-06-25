# User Flow: Event Creation & Configuration

**Use case:** A tenant admin creates an event and configures the facts about it (what it is, when, where, and what facilities exist), then publishes it so officials and participants can see it.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

In v1 one tenant equals one event, and the tenant name equals the race name. So "creating the event" is effectively configuring the tenant's single event. The model is kept event-neutral: event type is a configured attribute, not a hardcoded variant, so a swim meet and Viadal are the same model with different configuration.

## What gets configured

Grounded in scope item 1 (dates, distances, event type, location, facilities, logo, description).

- **Identity:** event/race name (equals tenant name), event type (configured attribute), logo, description.
- **When:** event dates / duration. Viadal is a 6-day event, so the model holds a date range, not a single date.
- **Structure:** Event → Stage/Day → Venue. An event can have multiple stages/days, each tied to a venue (course, route, pool, etc.). v1 must allow at least the Viadal case of multiple days.
- **Distances:** the distances offered (event-neutral, e.g. a running distance or a swim distance).
- **Where:** location and venue details.
- **Facilities:** the facilities available at the event (the list participants and officials will later see).
- **Scheduling granularity:** the configurable timeslot length (1 hour is the Viadal default), set per event. Configured here so it is in place before scheduling begins. (Confirmed/used again at the start of the scheduling flow.) Formerly called "timeslot unit".

## Admin flow: creating and configuring

1. Admin signs in and opens their event (the tenant's single event). On first use the event exists as a **draft** shell created when the tenant was provisioned by the system admin.
2. Admin fills in identity (name, type, logo, description).
3. Admin sets dates / duration and adds the stages/days and their venues.
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

- **Minimum to publish:** which fields are mandatory before publish is allowed? Proposal: name, at least one date, at least one stage/venue. To confirm when we do the screen doc.
- **Officials vs participants visibility on publish:** publishing currently exposes the event to both roles at once. If admins need to onboard officials before participants see anything, we may need two visibility switches. Flagged, not decided.
- **Edit-after-publish side effects:** changing dates or the scheduling granularity after scheduling has begun affects existing assignments. Out of scope to fully model now; flag for the scheduling revision.
- **Cross-cutting:** all field labels, type names, and facility labels are i18n strings (English only in v1, no hardcoded UI strings). All event data is tenant-scoped. Event type, facilities, and the draft/published mechanics are configuration, not hardcoded variants, so nothing here narrows the multi-tenant or feature-toggle promise.
