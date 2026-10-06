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

136 tests, all green. Counts below are from `--list` on 2026-10-06.

| Spec                          | Screens                                     | Tests |
| ----------------------------- | ------------------------------------------- | ----- |
| `auth.spec.ts`                | AUTH-01                                     | 8     |
| `access-control.spec.ts`      | permission matrix, every screen             | 54    |
| `admin-event.spec.ts`         | EVT-01, EVT-02                              | 15    |
| `admin-screens.spec.ts`       | WS-01, WS-02, OFF-01, COMM-01, ACCT-01      | 14    |
| `official-screens.spec.ts`    | HOME-01, INFO-01, MYSCH-01, ANN-01, ACCT-01 | 16    |
| `scheduling.spec.ts`          | SCHED-01                                    | 13    |
| `system-admin.spec.ts`        | SYS-01, SYS-02                              | 7     |
| `invite-confirmation.spec.ts` | AUTH-02                                     | 9     |

A full run takes about 6 minutes on one worker.

This table has drifted from the suite more than once — it is written by hand
after a run and nothing enforces it. Treat `--list` as the authority and this
as a summary, and re-check it before quoting a number.

Not covered, and worth knowing:

- **Participant screens**, deferred in v1 and not built.

AUTH-02 is covered as of #241. The note that used to sit here — two rival
implementations, with the live one needing to be resolved first — was wrong:
`/invite/[token]` and `/confirm-invite` are both live and serve different
entry points (the SMS link, and the invitee who never opens it and just signs
in with their number). `invite-confirmation.spec.ts` covers both.

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

The E2E suite first provisioned its own on `+46709900007`, added to
`[auth.sms.test_otp]`. Idempotent, so repeated runs are safe.

**Resolved.** `seed-dev.ts` owns this user now, so a plain
`npm run seed:dev:local` is enough to reach SYS-01/SYS-02 by hand — running the
E2E setup first is no longer the only way in. The role stays global
(`tenant_id` NULL, the shape migration 0021 made legal for it) and gets no
`officials` row: a system_admin is on no tenant's roster and is not schedulable.

It is the one row in that script that survives a reseed. The documented reset is
`delete from tenants where slug = 'seed-klubben'`, which cascades tenant-scoped
rows, and this one has no tenant to cascade from — so the seed writes it only
when absent, rather than colliding with `user_roles`' unique
`(user_id, tenant_id)`.

`global-setup.ts` keeps its `ensureSystemAdmin` backstop. It is no longer the
owner, but `ensureSeedData` returns early when the tenant already exists, so a
stack seeded before this change would otherwise never acquire the user.

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

**Resolved 2026-09-11** (migrations `20260911130436_ensure_admin_roster_row_rpc.sql`
and `20260911130546_backfill_admin_roster_rows.sql`; applied to dev and prod on
2026-09-28). The "how" is settled: a real `officials` row, written by an
`ensure_admin_roster_row` RPC. Two things in the write-up above turned out to be
wrong once measured, and are worth recording:

- **Not tenant creation.** `create_tenant_with_defaults` is called by a
  _system_admin_ and grants tenant_admin to nobody, so no admin exists to write a
  row for at that point. No application code path grants tenant_admin at all —
  only `scripts/seed-dev.ts` and manual DB work — so the row belongs to the
  role-grant moment, and the RPC waits for the SYS-02 flow that will make that
  reachable in-app.
- **Not 5 tenants.** Only viadal-2026 has any tenant_admin, and 2 of its 3 admins
  already held confirmed rows created through the ordinary invite flow on
  2026-07-07 — Peter and Lotta had worked around this by hand, which is probably
  why it was never reported as a live bug. The backfill inserts exactly one row.

The FK suspicion was right: synthesising on read would not have fixed SCHED-01,
since `assignments.official_id` needs a row to point at. Verified by assigning the
seeded admin to a work area on the local stack.

The three assertions that carried this discrepancy now assert presence instead of
absence.

**Verified on dev and prod 2026-10-01.** Both migrations are recorded in
`supabase_migrations.schema_migrations`, `ensure_admin_roster_row` exists, and
the query that found this defect — tenant_admins in `user_roles` with no
matching `officials` row — now returns 0 on both. The backfill behaved as
predicted on prod: viadal-2026's two hand-made rows still carry their 2026-07-07
timestamps and exactly one row was inserted. Note one case the write-up above
does not cover: on dev, `testklubben` has both a `removed` row from 2026-07-02
and a new row from 2026-09-28, because the RPC's reuse-first claim deliberately
skips removed rows rather than resurrecting them.

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
- A few places had no accessible marker for state at all: the scheduling view
  toggle and the official schedule view toggle marked the active option with a
  CSS class only. Tests asserted on `bg-primary`, which is brittle. The day
  selector on MYSCH-01 was the one place that did it properly, with
  `aria-current="page"`.

**Resolved — but not the way this finding proposed, and the lag is the lesson.**
Both toggles now carry real semantics: the official one is a `role="radiogroup"`
with `aria-checked`, roving `tabIndex` and arrow keys; the admin one is a
`role="tablist"` with `aria-selected`. `aria-pressed`, which this finding
suggested, would have been the wrong fix — it describes an independent on/off
per button, not one either/or choice, so a screen reader would announce
"pressed" rather than "1 of 2".

The toggles were fixed in passing (around #215) without this finding or the
tests being updated, so the suite kept asserting on a `bg-primary` class the
buttons no longer carry — and kept passing, because by then it was failing for
an unrelated reason first (see F9). A finding that proposes a fix should be
re-read against the code before anyone acts on it.

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

### F9 — UI language is per-user state, so a developer's click could break the suite

**Severity: medium. Fixed in this branch.**

The whole suite selects on English copy, and `playwright.config.ts` pins
`locale: 'en-GB'` believing that settles it. It does not. The UI language is a
per-user row in `user_preferences`, chosen in ACCT-01 — the browser locale
never enters into it.

`scripts/seed-dev.ts` sets no language at all, so those rows held whatever the
last person to click through the shared local stack happened to save. Two of
the four seeded users had drifted to `sv`. The result: 14 of 17 official specs
failed, every one of them waiting out a 60s timeout on an English selector
against a Swedish page, and the run took 9 minutes to tell us so.

Two things worth taking from it:

- **The failure pointed away from its cause.** Fourteen red tests across five
  screens look like a broken app. Nothing was broken, and nothing in the error
  text mentioned language — only Playwright's own page snapshot, which renders
  the accessibility tree and showed `heading "Mitt schema"`, gave it away.
- **It hid a second, real problem.** Behind the language failure sat four
  genuinely stale selectors (F6's toggle, an ambiguous `getByText`, a Save
  button that autosave replaced, and a pair of tests asserting an admin-only
  section on an official screen). A suite failing for one loud reason stops
  reporting the quiet ones.

`globalSetup` now pins every fixture user's language, the same way it already
clears rate-limit counters — the suite should not depend on local state no
fixture owns. Deliberately not a seed-script change: the seed is for realistic
data, and real officials do choose their own language.

---

### F10 — A saving cell has no button, so `:has(button)` indexing silently shifts

**Severity: medium (test infrastructure).** The subtlest thing SCHED-01 taught.

The by-person grid renders an assignable cell as a bare `<button>` and a cell
mid-save as a `<Skeleton>` — a `<div>` with no button at all. Addressing cells as
"the nth `td` containing a button" therefore looks right and reads well, and is
wrong the moment a save is in flight: every slot after the pending one shifts
left by one, so the next click lands an hour earlier than the test believes.

What made this expensive to find is that it does not fail where it happens. The
click succeeds, the assertion on that cell succeeds, and the damage shows up as
a later test finding an occupied cell it expected to be empty — or as an
assignment left behind in the database after a green run. It presented as
flakiness that moved between tests from run to run.

The fix is to index by column position (`td` offset by the sticky name column
plus the one out-of-window column) rather than by what a cell happens to
contain. Worth generalising: in a grid that swaps elements for skeletons while
saving, any locator phrased in terms of what a cell contains is a locator that
moves.

### F11 — Popups are positioned from the clicked cell, so a right-hand slot is unclickable at 1280px

**Severity: low (test infrastructure), but it looks like a product bug.**

The work-area picker and the cell action popup are `position: fixed`, placed
from the clicked cell's `getBoundingClientRect()`. At Playwright's default
1280x720 the right-hand slots of an eleven-column grid sit at the edge, so the
popup renders outside the viewport and Playwright refuses to click it —
"element is outside of the viewport", after scrolling into view has already
succeeded.

Not a defect in the screen: a real admin scrolls the grid horizontally and the
popup follows. But it is indistinguishable from one at first read, and it made
the over-capacity test fail only for the later slot it had been moved to in
order to avoid the seeded assignments. `scheduling.spec.ts` opts into a 1680px
viewport via `test.use()`, which is also the honest form factor for an
admin-only, desktop-first screen.

### F12 — The suite's first writing specs needed a cleanup that survives a killed run

**Severity: medium.** F7 predicted this; SCHED-01 is where it bit.

Every spec before this one restored a field it edited — an event name, a tier, a
toggle. SCHED-01's specs create rows. A test killed by a timeout, or a run
stopped with Ctrl-C, leaves assignments behind, and the shared seed tenant then
starts the next run dirty: a cell a later test expects to be empty is occupied,
and a stale over-capacity row changes what the conflict banner says. The failure
surfaces in a spec that did nothing wrong.

Three layers, in the order they do the work:

1. Each writing test restores in a `finally`, so an assertion failure mid-test
   still cleans up.
2. `clearCell()` loops rather than clicking once. An over-capacity slot holds
   several assignments in one cell and the popup lists a Remove per row, so one
   click is never enough — and `handleCellAction()` closes the popup _before_
   awaiting the delete, so the popup going away is not evidence the row is gone.
   The cell's own text is the only signal tied to the database.
3. `globalSetup` deletes leaked rows before the run, for the cases the first two
   cannot reach (SIGKILL, a crashed browser). Seeded assignments all carry a
   `todo_id`; rows written through the UI never do, because SCHED-01 has no todo
   picker. That makes `todo_id IS NULL` an exact line between fixture and debris
   without hardcoding which slots the specs use.

The third layer is the one worth keeping in mind when adding writing specs: it
is what makes a run reproducible after the previous one was interrupted.

### F13 — `selectStage()` returned before the URL was written

**Severity: low (test infrastructure).**

Clicking a stage in the dropdown relabels the trigger from local state
immediately, but `handleSelectStage()` then calls `changeDay()`, whose
`router.push()` writes `?stage=&day=` a beat later. A helper that waited on the
trigger's label therefore returned while the URL was still the old one, and a
test reading `searchParams` straight after got a stale value — intermittently,
depending on how fast the push landed.

Mentioned because the fix is a general one: when an interaction updates both
local state and the URL, wait on the URL. It is the slower of the two and the
one the server actually reads.

A related note for anyone extending these specs: the grid writes `?stage=` only
when the stage is _changed_, never on first load. A test that needs a stage id
has to change stage to get one; reading it from the initial URL yields an empty
string.

### F14 — A date literal in a spec passed until the day it didn't

**Severity: low (test infrastructure). Fixed 2026-10-06.**

`scheduling.spec.ts` asserted `toHaveURL(/day=2026-10-06/)` for the day pinned
when the stage changes to Day 2. The seed builds its stages relative to the day
it runs (`SEED_DAYS`), so that literal was true only on a stack seeded the day
the assertion was written. It failed on the next run against a stack seeded a
day later, reporting a mismatch between two dates that both looked plausible.

The fix asserts the relationship rather than the value: read the day for Day 1,
read it again for Day 2, and check the second is one day after the first. That
is what the screen actually promises, and it holds whenever the stack was
seeded.

Two things worth carrying forward:

- The seed script says this already. The comment above `SEED_DAYS` reads "a
  hardcoded date stops exercising it the moment that date passes" — the fixture
  had been made relative precisely so tests would not need literals, and a spec
  then wrote one anyway. A convention documented at the fixture does not
  propagate to the specs on its own.
- **Selecting two stages in a row hits F13 one step further on.** `selectStage()`
  waits for the URL to _match a shape_, and after the first selection the URL
  already matches it — so the helper returns immediately on the second call and
  a read straight after gets the previous stage's day. Waiting on a shape is
  only a sufficient signal the first time. The second selection now waits for
  the day to change.

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
ANN-01, SYS-01/02. Brought the suite to 113 tests at the time it landed; see
the status table above for the current count.

Re-audited 2026-10-06, because the card kept being picked up as if it were
open. Every screen it names does have coverage and the specs are all present.
One test in `scheduling.spec.ts` was failing — not a gap in this card's scope
but a date literal that had aged out (see F14) — now fixed, suite green at 136.

---

**[BUG] Seeded work areas have no stage_id, so WS-01 and SCHED-01 render empty**
Priority: — (done, PR #180)

See F8. Not a missing fixture but a stageless one: WS-01 groups by `stage_id`,
so work areas with NULL never render. Now generated per stage.

---

**[TEST] E2E coverage for SCHED-01**
Priority: — (done, branch `test/e2e-sched01`)

13 tests in `scheduling.spec.ts`, covering all four of the quirks this card
named: autosave with no Save button (asserted by reloading, so the check is
against the database rather than React state), stage and day restored from a
shared URL while the view toggle deliberately is not, over-capacity accepted
with a warning against out-of-window rendered unclickable, and the by-work-area
rows that only expose slot rows once expanded.

Four findings came out of writing it — F10 to F13. F10 is the one worth reading
before touching these specs: a cell mid-save renders a skeleton with no button,
so any `:has(button)` index silently shifts and the failure lands in a different
test than the one that caused it.

The screen itself came out clean. No product defects found — the earlier F6
concern about the view toggle is already fixed in the app, and the F-MNT-20
admin roster row is now asserted positively here.

---

**[TEST] E2E coverage for AUTH-02 invite confirmation**
Priority: Medium

Invited official → Confirmed, via the SMS token link. Two implementations exist
(`/invite/[token]` and `/confirm-invite`) and it is unclear which is the live
path — worth resolving as part of this.

---

**[BUG] Event admin missing from the officials roster, unschedulable, 404s on their own account screen**
Priority: Medium — ticketed as F-MNT-20 — **RESOLVED 2026-09-11, pending dev/prod apply**

See F4 for what was actually done, including two corrections to the plan below:
the row belongs to the role-grant moment rather than to tenant creation, and the
prod backfill is one row, not five tenants.

Original description: Peter decided (2026-06-24) that an admin is always schedulable and
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

**[BUG] Two admin specs still assume the tenant admin has no officials row**
Priority: Medium — RESOLVED

Found while fixing F9, left alone as out of scope at the time. Both failed on
`main`; both were confirmed stale tests, not broken screens, and are fixed:

- `ACCT-01 admin account › shows an editable name and a read-only number` —
  expected the admin-only form (label `Name`). There is no admin-only form any
  more: `admin/account/page.tsx` renders the same `AccountForm` as the
  official-facing screen and `notFound()`s when the roster row is missing. Now
  asserts `Name (editable)` / `Mobile number (read-only)`.
- `OFF-01 officials roster › lists the admin on the roster as Event admin` —
  the `/— Event admin$/` filter never matched. `hasText` tests the row's whole
  concatenated text, which runs on past the name into the number and status
  cells (`…— Event admin+46 70 990 00 01Confirmed`), so an end anchor cannot
  match a grid row at all. The assertion was never capable of passing in this
  markup; dropping the anchor matches exactly one row.

Both were fallout from F-MNT-20 (#187), which gave tenant admins their roster
row — the behaviour changed, the specs did not. The screens were correct
throughout.

---

**[A11Y] Three admin fields were named only by their placeholder**
Priority: Low — FIXED

Chased down from a `useLabel` warning in the E2E dev-server output ("If you do
not provide a visible label, you must specify an aria-label…"). A placeholder
is not an accessible name: it is not exposed as one, and it disappears the
moment the field has text. Three fields had nothing else:

- the checklist/notes row input (WS-02) — now named off its list's heading
- the slot-modal official search (SCHED-01)
- the announcement composer (COMM-01) — named off the card heading above it

All three reuse strings that already exist in both `en` and `sv`, so no new
keys and no locale-parity risk.

---

**[NOISE] The `useLabel` warning in dev output is HeroUI's, not ours**
Priority: Low — no action

Worth writing down because it looks actionable and is not. After the three
fixes above, the warning still appears ~24 times in an `admin-event` run.
Instrumenting `@react-aria/label` to print a stack trace puts every remaining
one inside `useDateRangePicker` → HeroUI's `DateRangePicker`, reached from
`stage-modal.tsx`, which _does_ pass a `label`.

The rendered result is fine — each segment carries a full accessible name:

    spinbutton "år, Startdatum, Start / end time Startdatum Slutdatum Kalender"

It is the wrapping `group` element that has no name of its own, which is what
React Aria is complaining about. Nothing a screen-reader user hits is
unlabelled. Don't spend time on it again, and don't "fix" it by bolting an
`aria-label` onto the picker — that would paper over a library internal and
change what the segments announce.

---

**[TEST] Run integration + E2E suites in CI**
Priority: Low — E2E DONE, integration was already there

Half of this was a stale premise: `test-integration` has been a job in
`quality.yml` for some time, and it is what made the E2E job cheap to add —
the hard parts (pinned Supabase CLI, `supabase start`, waiting for PostgREST
to accept service-role queries) were already solved and proven there.

The E2E job now runs on every PR. What it needs beyond the integration
recipe:

- `npx playwright install --with-deps chromium` — one browser, because
  `playwright.config.ts` defines a single project.
- `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN: dummy` on `supabase start`. The value
  is irrelevant: `[auth.sms.test_otp]` intercepts the seed numbers before
  Twilio is called, which is what makes real UI sign-in possible on a runner.
- No seed step. `global-setup.ts` runs `npm run seed:dev:local` itself when
  the tenant is missing, which it always is on a fresh runner; seeding twice
  would make the seed script throw, by design.
- No env pinning. With `CI` set, `reuseExistingServer` is false, so Playwright
  always starts its own dev server with the local stack pinned — and there is
  no `.env.local` on a runner for it to misread (F8).
- The HTML report is uploaded on failure, carrying the trace and screenshot
  for each one. Without it a CI-only failure can only be debugged by
  reproducing it locally.

Runtime is ~3 minutes locally from cold, including seeding and five real
sign-ins; `timeout-minutes: 30` is a hang ceiling, not an expectation.
