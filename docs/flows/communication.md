# User Flow: Communication

**Use case:** A tenant admin sends announcements to participants and officials; both groups read them.
**Version:** v0.2 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

## Channel model (v1 / MVP)

- **Participant announcement channel:** one per event. Admin-publish only. Participants read.
- **Officials announcement channel:** one general channel per event. Admin-publish only. Officials read.
- Both are one-way: only the admin publishes. SMS notifications on by default per recipient settings, with opt-out in personal account settings.

## Admin flow: publishing announcements

1. Admin opens Communication and picks a channel (participants or officials).
2. Writes an announcement and publishes.
3. The announcement appears in the channel timeline and SMS goes out to that audience per their notification settings.

## Reader flow (officials and participants)

1. User signs in and opens Communication.
2. Sees the announcement channel for their role, read-only.
3. Receives SMS for new announcements unless opted out.

## Planned for a later version (not v1)

These were discussed and deliberately deferred:

- **Per-work-area channels:** one channel per work area, with membership following schedule allocation.
- **Two-way / interactive messaging for officials:** officials can post in the channels they belong to.
- **Admin "important" checkbox:** chat posts are in-app only by default; an admin can flag a post as important to trigger SMS to the channel.

When this lands it must sit behind the feature-toggle layer so a tier can gate it, and it needs decisions on channel-membership lifecycle on unassignment, moderation, and notification volume.

## Cross-cutting

- All channel names and labels are i18n strings; English only in v1.
- Channels and membership are tenant-scoped.
