# E2E UI test suite — findings

Written 2026-09-10 while building the first browser-level test suite (Playwright)
for the app. The suite signs in through the real SMS-OTP form and drives the UI
as each role.

Everything below was observed on the local stack, not inferred from reading code.
Where a run verified something, the numbers are quoted.

---

## Why this suite exists

The repo had 86 test files before this work: 54 unit tests and 32 integration
tests. All of them stop at the server boundary — integration tests talk to
PostgREST and RPCs directly, unit tests mock the Supabase client.

Nothing exercised a browser. That leaves two classes of defect uncovered:

1. **Screen reachability.** Auth guards live in layouts and page components —
   there is no `middleware.ts`. A missing `getAdminTenant()` call would expose an
   admin screen to an official while every RLS test stayed green.
2. **The login flow itself.** AUTH-01 is the only way into the app and had no
   end-to-end coverage at all.

---

## Status of the suite

113 tests, all green.

| Spec                       | Screens                                     | Tests       |
| -------------------------- | ------------------------------------------- | ----------- |
| `auth.spec.ts`             | AUTH-01                                     | 8           |
| `access-control.spec.ts`   | permission matrix, every screen             | 53          |
| `admin-event.spec.ts`      | EVT-01, EVT-02                              | 15          |
| `admin-screens.spec.ts`    | WS-01, WS-02, OFF-01, COMM-01, ACCT-01      | 14          |
| `official-screens.spec.ts` | HOME-01, INFO-01, MYSCH-01, ANN-01, ACCT-01 | 17          |
| `system-admin.spec.ts`     | SYS-01, SYS-02                              | 6           |
| —                          | SCHED-01                                    | not started |
| —                          | AUTH-02 (invite confirmation)               | not started |

A full run takes about 2 minutes on one worker.

Not covered, and worth knowing:

- **SCHED-01**, the most complex screen. Notable for whoever picks it up: no
  Save button (it autosaves via `use-scheduling-autosave`), stage and day live
  in the URL while the view toggle is local state, over-capacity is a soft
  warning while out-of-window is hard-blocked, and the by-work-area view only
  accepts edits when a row is expanded. Now unblocked — see F8.
- **AUTH-02**, invite confirmation. Two implementations exist —
  `/invite/[token]` and `/confirm-invite` — and which one is live needs
  resolving first.
- **Participant screens**, deferred in v1 and not built.

---

## Findings

### F1 — `.env.local` points at dev cloud, so E2E silently tests the wrong database

**Severity: high.** This is the finding with teeth.

`.env.local` ships with `NEXT_PUBLIC_SUPABASE_URL` set to the dev cloud project
and the local line commented out. A plain `npm run dev` therefore talks to dev.

What makes it dangerous rather than merely wrong: the same seeded phone numbers
exist in dev, so **sign-in succeeds and tests pass**. The first run of this suite
had 4 of 8 tests passing against the dev database before I noticed. A writing
test suite pointed at a shared environment is a data-integrity problem, not a
test problem.

Mitigated in `playwright.config.ts` (pins the dev server's Supabase env to the
local stack) and `tests/e2e/global-setup.ts` (probes a running server with a
local-only test number and refuses to continue if it is rejected).

DEVELOPMENT.md documents the adjacent `next build` inlining trap, but not this
one.

### F2 — GoTrue's SMS throttle rejects the second sign-in of every run

**Severity: medium (test infrastructure).**

`supabase/config.toml` had `[auth.sms] max_frequency = "5s"`. Signing several
users in back to back trips it, and GoTrue answers `over_sms_send_rate_limit`.

The failure is badly disguised: the login page stays on the phone step with a
toast, which at the point of failure is indistinguishable from a broken
selector. I spent a while chasing it as a selector bug.

Changed to `1s` locally, matching what `[auth.email]` already used. The hosted
projects are unaffected — this file is local-only.

### F3 — No system_admin exists in seed data, so SYS-01/SYS-02 were untestable

**Severity: low.**

`scripts/seed-dev.ts` seeds a tenant admin and five officials, but no system
admin. That is defensible — the role is global (`user_roles.tenant_id` must be
NULL per migration 0021) and does not belong to a tenant's seed data — but it
means the two system screens could not be reached by any test.

The E2E suite now provisions its own on `+46709900007`, added to
`[auth.sms.test_otp]`. Idempotent, so repeated runs are safe.

Worth deciding: should `seed-dev.ts` own this user instead, so manual local
testing of SYS-01/02 works too? Right now you can only reach those screens by
running the E2E setup first.

### F4 — The tenant admin is missing from the officials roster, is unschedulable, and 404s on the official account screen

**Severity: medium.** A settled decision left unimplemented, visible on three screens.

A decision from Peter (2026-06-24, `docs/flows/officials-management-registration.md:18`)
says the event admin appears on the roster automatically, as implicitly
Confirmed, without an SMS invite — marked `<name> — Event admin` and without
action buttons. `docs/flows/officials-scheduling.md:22` repeats it and
`.claude/CLAUDE.md:78` codifies it as an implementation rule. Three observations
say otherwise:

- **OFF-01**: the roster lists only the seeded officials. No admin row.
- **ACCT-01 (official variant)**: `/{slug}/account` renders from an `officials`
  row and calls `notFound()` when there is none, so the admin gets a 404 —
  while reaching every _other_ official surface fine.
- **SCHED-01**: the schedulable pool is `officials` filtered to
  `invite_status='confirmed'`, so the admin is absent from the grid entirely.

One root cause: the seeded tenant admin has a `user_roles` row but no matching
`officials` row. Appearing on three screens is what makes this look like a real
gap rather than a quirk of one page.

**Correction to my first write-up:** I framed this as an open product question
needing Peter. It is not — Peter decided it in June, and the decision names this
exact scenario ("a race director who both plans and staffs a post"). The app
does not implement it. What is still open is only _how_: synthesise the roster
row on read, or write a real `officials` row at tenant creation. The latter is
closer to the decision's wording and is probably required anyway, since
`assignments` needs a row to reference by FK.

Ticketed as F-MNT-20 in `docs/quality-requirements.md` after Eduardo pointed out
in review of PR #177 that this lived only in a test document and so had no owner.

The tests assert today's behaviour and carry the discrepancy in a comment, so
the gap stays visible without the suite going red.

### F5 — Permission matrix holds

**No defects found.** All 53 assertions green across every screen and role:

- signed out → every screen redirects to `/login`; API routes answer 401 rather
  than redirecting (so a `fetch()` caller does not get an HTML login page with a 200)
- official → 404 on all 7 admin screens and both system screens, 200 on all 5
  official screens
- tenant admin → 404 on both system screens, 404 on another tenant's dashboard,
  200 on all admin screens
- system admin → 200 everywhere, including tenant screens where they hold no
  `user_roles` row (the `is_system_admin()` clause working as designed)

The only surprise was the tenant admin's 404 on the official account screen,
which turned out to be correct behaviour given the data — see F4.

### F6 — The app has no `data-testid` anywhere

**Severity: informational.**

Every selector in this suite is role-, label- or text-based. That is usually the
better practice, but two consequences are worth knowing:

- Selectors are coupled to the English copy in `public/locales/en/`. Renaming a
  button breaks tests. Since `sv` is intentionally incomplete and the app
  defaults to `en`, this is stable today.
- A few places have no accessible marker for state at all: the scheduling view
  toggle and the official schedule view toggle mark the active option with a CSS
  class only — no `aria-pressed`, no `role="tab"`. Tests assert on `bg-primary`,
  which is brittle. The day selector on MYSCH-01 is the one place that does it
  properly, with `aria-current="page"`.

Adding `aria-pressed` to those toggles would be a small accessibility win and
would let the tests assert something meaningful.

### F7 — Seed script is not idempotent

**Severity: informational.**

`npm run seed:dev:local` throws if `seed-klubben` already exists, deliberately.
The E2E global setup therefore checks for the tenant and only seeds when absent,
rather than reseeding per run.

Consequence: the suite runs against **shared, mutable** seed data. The specs
restore what they change (event name, tenant tier, SMS opt-out, activation), and
`workers: 1` keeps them from racing. It works, but it is a constraint to respect
when adding specs — a test that leaves the tenant dirty will break later ones.

### F8 — Seeded work areas had no `stage_id`, so WS-01 and SCHED-01 rendered empty

**Severity: low. Fixed in PR #180.**

My first reading of this was wrong, and the correction is the interesting part:
WS-01 reported "0 work areas" for every stage, which looked like the seed
creating no work areas. It creates two — with a **NULL `stage_id`**.

WS-01 groups its list with `workstations.filter(ws => ws.stage_id === stage.id)`,
so a stageless work area belongs to no group and never renders. The rows were
in the database the whole time. Nothing was broken in the app, only in the
fixture — and it matches the v0.7 stage-model gap, since the seed predates work
areas belonging to a stage.

Same cause for SCHED-01, which is scoped per stage: its grid had nothing to
assign against.

The fix generates work areas per stage (6 across 3 stages, one operating window
each on its own day). One knock-on: the MYSCH-01 fixture's "same work area on
two days" case is not expressible when a work area belongs to one stage, so it
is now the same work area _name_ on two stages.

Worth remembering as a pattern: an empty screen is as likely to be a fixture
that does not satisfy a grouping predicate as it is a fixture that is missing.

---

## Suggested Trello cards

Copy-paste ready. Priorities are my read, not Peter's.

---

**[TEST] E2E UI suite — foundation (AUTH-01 + permission matrix)**
Priority: — (done, PR `test/e2e-foundation`)

First browser-level tests. Playwright against the local stack, real SMS-OTP
sign-in per role, plus the full role/screen permission matrix. 61 tests green.
Includes three layers of guard against running at dev or prod.

---

**[TEST] E2E coverage for admin, official and system screens**
Priority: — (done, PR `test/e2e-remaining-screens`)

EVT-01/02, WS-01/02, OFF-01, COMM-01, ACCT-01, HOME-01, INFO-01, MYSCH-01,
ANN-01, SYS-01/02. Brings the suite to 113 tests, green.

---

**[BUG] Seeded work areas have no stage_id, so WS-01 and SCHED-01 render empty**
Priority: — (done, PR #180)

See F8. Not a missing fixture but a stageless one: WS-01 groups by `stage_id`,
so work areas with NULL never render. Now generated per stage.

---

**[TEST] E2E coverage for SCHED-01**
Priority: Medium — unblocked by #180

The most complex screen and the only major one with no E2E coverage. Notable
for testing: no Save button (autosaves via `use-scheduling-autosave`), stage
and day live in the URL while the view toggle is local state, over-capacity is
a soft warning while out-of-window is hard-blocked, and the by-work-area view
only accepts edits when a row is expanded.

---

**[TEST] E2E coverage for AUTH-02 invite confirmation**
Priority: Medium

Invited official → Confirmed, via the SMS token link. Two implementations exist
(`/invite/[token]` and `/confirm-invite`) and it is unclear which is the live
path — worth resolving as part of this.

---

**[BUG] Event admin missing from the officials roster, unschedulable, 404s on their own account screen**
Priority: Medium — ticketed as F-MNT-20

See F4. Peter decided (2026-06-24) that an admin is always schedulable and
appears on the roster automatically as implicitly Confirmed. Not implemented:
the tenant admin has a `user_roles` row but no `officials` row, so OFF-01 omits
them, `/{slug}/account` returns 404, and SCHED-01's Confirmed-only pool excludes
them — a race director cannot staff themselves onto a post. Decide whether the
row is synthesised on read or written at tenant creation (the latter likely
required, since `assignments` needs an FK target) and backfill the 5 prod
tenants if so.

---

**[MNT] Add `aria-pressed` to view toggles (scheduling + my schedule)**
Priority: Low

See F6. Active view is signalled by CSS class only, so tests assert on
`bg-primary`. Accessibility win, and makes the tests non-brittle.

---

**[MNT] Seed a system admin in `scripts/seed-dev.ts`**
Priority: Low

See F3. SYS-01/SYS-02 currently cannot be reached manually on a fresh local
stack. The E2E suite provisions one on `+46709900007`; moving that into the seed
would help manual testing too.

---

**[DOC] Document the `.env.local` dev-cloud trap in DEVELOPMENT.md**
Priority: Medium

See F1. DEVELOPMENT.md covers the `next build` inlining trap but not that a
plain `npm run dev` talks to dev cloud — where sign-in succeeds, so the mistake
is silent. It caught me while building this suite — the first run scored 4 of 8
passing against the dev database before I noticed.

---

**[TEST] Run integration + E2E suites in CI**
Priority: Low (needs discussion)

Neither the integration suite nor E2E runs in `quality.yml` today — only lint,
format, typecheck and unit tests. Both need a local Supabase stack in the
runner, so this is a real piece of work, not a config tweak. Worth scoping
before committing to it.
