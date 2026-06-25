# User Flow: Event Info View

**Use case:** A signed-in user reads the public-facing facts about the event: what it is, where it happens, what facilities exist, the event programme/schedule, and links to results.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

This is the shared, read-only "about the event" view (scope item 3). This flow specifies the **official-facing** version now; the **participant-facing** version reuses the same view and adds the participant's personal view (bib/category and Race Results link) in a later flow. The view shows only a **published** event (see event-creation-config), and an official reaches it once **Confirmed** (see officials-management-registration).

## What the view shows

Sourced from the event configuration (event-creation-config):

- **Identity:** event/race name, logo, event type, description.
- **When:** dates / duration, broken out by stage/day.
- **Where:** location and the venue(s) per stage/day.
- **Facilities:** the facilities configured for the event.
- **Event schedule (programme):** the timetable of the event itself, organised by stage/day. This is the *event programme*, not the official's personal duty schedule. The personal duty schedule is a separate view (officials-scheduling).
- **Race Results links:** one or more embedded links out to Race Results pages. No timing or results are computed in-house.

## User flow: reading event info

1. User signs in and opens Event info.
2. They read identity, dates, location/venues, and facilities.
3. They browse the event schedule/programme by stage/day.
4. They follow a Race Results link to view results on Race Results' own pages.
5. The view is entirely read-only.

## Reuse for participants (later flow)

- The participant version shows the same event info, facilities, location, schedule, and Race Results links.
- It adds the participant's personal view (their own bib/category and a link to their Race Results page), which is out of scope for this flow.
- Because the view is shared, its content must be driven by configuration and role, not hardcoded for officials.

## Notes and open questions

- **What "schedule" means here:** DECISION (Peter 2026-06-24): the event schedule is the stage/day structure with their times and venues (already in event config), **not** a separate richer activity programme. A finer programme (ceremonies, briefings, start waves as distinct timetabled items) is a later config extension if an event needs it.
- **Race Results links placement:** DECISION (Peter 2026-06-24): the official-facing event info **does** show Race Results links in v1, so officials can follow the status of the competition. Participant-specific links still live in the participant personal view.
- **Facilities detail:** v1 shows the configured facility list. Whether facilities carry richer data (location on site, opening hours) is a config question flagged in event-creation-config, not decided here.
- **Cross-cutting:** all labels and configured content are i18n strings (English only in v1, no hardcoded UI strings). All event data is tenant-scoped. The view is shared infrastructure across roles with role-specific additions, so it must not encode a single role or a single sport.
