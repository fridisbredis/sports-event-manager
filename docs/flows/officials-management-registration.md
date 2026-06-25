# User Flow: Officials Management & SMS-Invite Registration

**Use case:** A tenant admin adds and removes officials for the event and invites them via SMS. An invited official registers their account from the SMS link and becomes a usable, schedulable member of the event.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

Officials are invited via SMS (no email fallback in v1; SMS provider selected by Frida). The admin builds the roster; the official completes their own account from the invite. This roster is what the scheduling flow assigns from, and what the personal-account and event-info views are gated behind.

## Official record and states

An official record carries at least: name and mobile number (the SMS identity). Each record has a state:

- **Invited:** added by the admin, SMS sent, not yet confirmed.
- **Confirmed:** the person has opened the SMS link, verified their mobile number, and confirmed they are available. They can now sign in and, importantly, are now schedulable.
- **Removed:** taken off the event by the admin (see removal below).

## Admin as schedulable staff

DECISION (Peter 2026-06-24): an admin is **always schedulable**. When the event is created, the admin's own account appears automatically as the **first official/staff member** in the roster, implicitly **Confirmed** (no SMS invite or availability confirmation needed for themselves, since they are an authenticated admin). This is how an admin (e.g. a race director who both plans and staffs a post) enters the schedulable pool. Roles are not mutually exclusive.

## Admin flow: adding and inviting officials

1. Admin opens Officials for the event.
2. Adds an official by entering name and mobile number.
3. The system sends an SMS invite with a registration link to that number. The record is now **Invited**.
4. Admin can re-send the invite if the person did not act on it.
5. The roster shows each official's state (Invited / Confirmed) so the admin can see who has confirmed availability and who is still outstanding. Only Confirmed officials appear as schedulable in the scheduling grid.

## Admin flow: removing officials

1. Admin removes an official from the event.
2. If the official has existing assignments, removal frees those assignments and the admin is warned which timeslots/workstations are affected (consistent with the "warn but allow" pattern), so coverage gaps are visible rather than silent.
3. A removed official can no longer sign in to this event.

## Official flow: confirming from the SMS invite

1. Official receives the SMS and opens the link.
2. They **verify their mobile number** (confirms the admin captured the right number) and **confirm they are available** for the event.
3. They complete their account: set name if not prefilled, and see their notification setting (SMS on by default, opt-out available in personal account settings).
4. On completion the record becomes **Confirmed**. Only now can they sign in to their personal account, see event info, and read their own schedule, and only now are they schedulable.
5. They do not gain any admin or editing rights; officials are read-only over their own data.

## Schedulability gate

DECISION (Peter 2026-06-24): an official is **not schedulable until Confirmed**. The admin cannot assign someone who has not verified their number and confirmed availability. This is deliberately stricter than letting the admin pre-plan with unconfirmed people: the value is knowing both that the contact number is correct and that the person is actually available before relying on them in the schedule. The scheduling grid therefore lists only Confirmed officials.

## Notes and open questions

- **Invite link mechanics:** expiry, single-use, and re-send behaviour are **governed by the SMS handling system Frida selects**, not specified here. The flow only requires that the link leads to number-verification and availability-confirmation.
- **Duplicate numbers:** DECISION (Peter 2026-06-24): a mobile number must be **unique within a tenant** and maps to exactly one user in that tenant. Adding an existing number to the same event is prevented.
- **Cross-tenant identity:** DECISION (Peter 2026-06-24): numbers are **not** required unique across tenants. Each tenant invites its own officials, and the same person can work for different tenants as separate, unlinked accounts. We deliberately do not build a shared cross-tenant identity, since little user data is tenant-independent and merging adds complexity without clear benefit. This keeps tenant isolation clean per the multi-tenant non-negotiable.
- **Cross-cutting:** all labels and SMS copy are i18n strings (English only in v1, no hardcoded UI strings). All official records and invites are tenant-scoped.
