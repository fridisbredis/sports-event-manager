# User Flow: Official Personal Account

**Use case:** A signed-in official views and manages their own account: their details, notification settings, and a way into their own schedule.
**Version:** v0.1 · **Date:** 2026-06-24 · **Owner:** Peter Thorn

The personal account view exists for all authenticated users (scope item 7). This flow covers the **official's** version. The participant's version (bib/category and Race Results link) is a later flow. An official reaches this view after they are **Confirmed** (see officials-management-registration). Officials are read-only over event data; the account is the one place they can change their own settings.

## What the official sees

- **Name.**
- **Mobile number** (their SMS identity).
- **Notification settings:** SMS notifications on by default, with an opt-out toggle.
- **Link to own schedule:** an entry point into their personal schedule view (the read side of officials-scheduling).

## Official flow: viewing and editing

1. Official signs in and opens their personal account.
2. They see their name, mobile number (read-only), and notification settings.
3. They can edit their name.
4. They can toggle SMS notifications off (opt-out) or back on.
5. They follow the link to view their own schedule. They cannot edit assignments here.
6. They see only their own data. No other official's data, no admin functions, nothing cross-tenant.

## Notes and open questions

- **Editing the mobile number:** DECISION (Peter 2026-06-24): the official **cannot edit their number in v1**. The number is shown read-only. To correct a number, the admin removes the official and adds them again with the right number (re-invite). A self-service number change with re-verification is a later refinement.
- **Notification granularity:** DECISION (Peter 2026-06-24): v1 treats the opt-out as a single SMS on/off. **Increased granularity is wanted going forward** (e.g. separate control of announcement SMS vs schedule-change SMS), as a later refinement, ideally behind the feature-toggle layer.
- **Withdrawing availability:** DECISION (Peter 2026-06-24): in v1 dropping out is **admin-mediated removal** only (officials-management); there is no self-service toggle. Planned (not critical for v1): a "request to withdraw" button on the personal account that flags the admin, who confirms and performs the removal.
- **Schedule view detail:** the official's schedule view itself (including the two-view question) is specified in the scheduling flow and its revision, not here.
- **Cross-cutting:** all labels are i18n strings (English only in v1, no hardcoded UI strings). All account data is tenant-scoped. The personal-account screen is shared infrastructure across roles, with role-specific content (official vs participant), so it must not hardcode a single role's fields.
