# Quality Requirements and Initial Assessment

- **Product:** Viadal Event Planner
- **Model:** ISO/IEC 25010 (SQuaRE) quality profile
- **Version:** 0.1
- **Date:** 2026-08-11
- **Status:** Proposed requirements; initial source-code assessment completed
- **Last verified:** 2026-08-11 after the lint and Prettier errors were fixed

## Purpose and scope

This document turns the product's non-functional expectations into measurable
requirements. It focuses on the three quality characteristics that matter most
before wider production use:

1. **Security** — protecting personal data, tenant isolation, access control,
   and the SMS integration.
2. **Performance efficiency and capacity** — keeping the application responsive
   as an event, its schedule, and its notification audience grow.
3. **Maintainability** — allowing a small team to change the product safely,
   understand its architecture, and release with confidence.

This is a quality plan, not a claim of ISO certification. Requirements marked
**Proposed** need product-owner approval before they become release gates.

## Assessment boundary and current evidence

The initial assessment was a static review of the repository plus local quality
checks on 2026-08-10. It did not test the live Supabase configuration, Azure
configuration, Twilio account, or production traffic.

| Check                | Result                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/component tests | 14 test files and 145 tests passed                                                                                                                                                                  |
| Type check           | Passed (`tsc --noEmit`)                                                                                                                                                                             |
| Lint                 | Passed: `eslint .` exits successfully with no reported errors or warnings. The `Lint` status is selected as required by the `main` branch ruleset.                                                  |
| Formatting check     | Passed: `npm run format:check` reports no style issues. The `Format` status is selected as required by the `main` branch ruleset.                                                                   |
| Production build     | Could not complete in the assessment environment because `next/font` could not fetch Google Fonts; it also warned about an inferred workspace root and the deprecated `middleware` convention       |
| Dependency audit     | Reported three high-severity production dependency findings, including Next.js, PostCSS, and Sharp                                                                                                  |
| CI/SAST              | CodeQL is configured for pushes, pull requests, manual runs, and weekly scans. The `main` branch ruleset selects the CodeQL analysis as required and requires high-or-higher code-scanning results. |

## Quality objectives and release requirements

### 1. Security

| ID     | Requirement                                                                                                          | Acceptance criterion                                                                                                                                                                     | Verification                                                                                                          | Priority |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| SEC-01 | Tenant data must be isolated at both application and database layers.                                                | A user from tenant A cannot read, create, update, or delete tenant B's data, including through direct API calls and Supabase queries.                                                    | Automated integration tests with real JWTs and a disposable Supabase database; RLS policy review for every migration. | Must     |
| SEC-02 | Every protected route must enforce the required role, not merely the existence of any role in the tenant.            | Tests prove that `participant`, `official`, `tenant_admin`, and `system_admin` cannot access functions outside their permission matrix.                                                  | Route/API integration tests and an explicit role-permission matrix.                                                   | Must     |
| SEC-03 | Service-role access must be exceptional, contained, and auditable.                                                   | User-scoped reads and writes use the authenticated Supabase server client. Each service-role use is listed with justification, input validation, authorization check, and a test.        | Code review rule, repository search, and integration tests.                                                           | Must     |
| SEC-04 | Invitation confirmation must bind the invitation to the verified phone identity and be single-use under concurrency. | Confirmation succeeds only when the authenticated user's verified phone matches the invited phone. Concurrent attempts result in exactly one confirmed official and one role assignment. | Integration tests for mismatched phones and concurrent requests; atomic database transaction/RPC test.                | Must     |
| SEC-05 | Notification preferences must be honoured.                                                                           | No official with `sms_opt_out = true` receives an announcement SMS. Equivalent participant preference behaviour is explicitly modelled and tested.                                       | Route test plus an end-to-end Twilio test double.                                                                     | Must     |
| SEC-06 | Dependencies with high or critical known vulnerabilities must not ship.                                              | `npm audit --omit=dev --audit-level=high` exits successfully, or an approved, time-limited exception is recorded with mitigation.                                                        | CI dependency-audit job and release review.                                                                           | Must     |
| SEC-07 | Security-sensitive actions must be traceable and abuse-resistant.                                                    | Admin role changes, tenant changes, invitations, and bulk SMS sends have structured audit events. Invitation and SMS endpoints have rate limits and alerting.                            | Log/audit-event tests; staging verification.                                                                          | Should   |

### 2. Performance efficiency and capacity

The following workload is a **proposed baseline** for acceptance testing. It
must be replaced with numbers agreed with the product owner before release:

- One six-day event with 500 officials, 100 work areas, and 50,000 assignments.
- 20 concurrent tenant-admin sessions editing or viewing schedules.
- 1,000 concurrent read-only official/participant sessions during an event.
- An announcement audience of 500 recipients.

| ID      | Requirement                                                                 | Proposed acceptance criterion                                                                                                                                                                                | Verification                                                                                  | Priority |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | -------- |
| PERF-01 | Core read paths remain responsive at the agreed baseline.                   | p95 server response time is at most 2 seconds for dashboard, event information, own schedule, and a stage-filtered scheduling view; error rate is below 1%.                                                  | Load test against staging with production-like seed data; application and database telemetry. | Must     |
| PERF-02 | Schedule changes remain correct and responsive under concurrent editing.    | p95 save time is at most 2 seconds; conflicts are reported deterministically; no duplicate workstation/timeslot/slot assignments are persisted.                                                              | Concurrent load test and database-constraint tests.                                           | Must     |
| PERF-03 | The scheduling UI has a bounded data strategy.                              | The client loads only the selected stage/date/range and virtualises or paginates large grids; it does not require every assignment for an event in browser memory.                                           | Performance test with the baseline dataset; browser profiling.                                | Must     |
| PERF-04 | Bulk notifications do not tie up the web request or exceed provider limits. | Sending is queued with bounded concurrency, retries, idempotency, and per-recipient delivery status. The publish request acknowledges the queued job rather than synchronously waiting for all SMS requests. | Staging test with a Twilio test double and failure injection.                                 | Must     |
| PERF-05 | The system can be operated under load.                                      | Health/readiness endpoint, structured logs, request/error metrics, database metrics, and alerts are available; Azure scale limits are documented and tested.                                                 | Staging operational readiness review.                                                         | Should   |

### 3. Maintainability

| ID     | Requirement                                                           | Acceptance criterion                                                                                                                                                                                                            | Verification                                                  | Priority |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| MNT-01 | Every change is checked automatically before merge.                   | CI runs formatting, linting, type checking, unit tests, integration tests, production build, CodeQL, and dependency audit. The deployment workflow depends on the quality workflow succeeding.                                  | Pull-request workflow test.                                   | Must     |
| MNT-02 | The static-analysis and formatting tools are working and enforced.    | The lint command succeeds using the supported ESLint invocation for the installed Next.js version. Prettier check has zero violations.                                                                                          | CI gate.                                                      | Must     |
| MNT-03 | Critical business rules have layered test coverage.                   | Tests cover tenant isolation, role permissions, invitation confirmation, SMS opt-out, scheduling conflicts, and partial SMS failures at unit and integration levels; the login/invitation journey has an end-to-end smoke test. | Traceability from this document to test files and CI results. | Must     |
| MNT-04 | Data access and authorization follow one documented pattern.          | The C4 documentation, developer documentation, and code agree on when to use the session client, service role, RLS, and application-level authorization. Material changes are recorded as Architecture Decision Records (ADRs). | Documentation/code review.                                    | Must     |
| MNT-05 | Complex scheduling code is understandable and independently testable. | Scheduling domain logic is kept in small, pure modules with unit tests; the current large grid component is split into focused view and interaction components.                                                                 | Code review; module-level test coverage.                      | Should   |
| MNT-06 | Builds are repeatable in CI.                                          | The build has an explicit Turbopack workspace root and does not depend on an uncontrolled external font download, or that dependency is deliberately provisioned and monitored.                                                 | Clean CI build from a fresh checkout.                         | Should   |

**Current CI coverage:** lint, formatting, and CodeQL are configured as
required checks for `main`. MNT-01 remains incomplete until type checking,
unit tests, integration tests, production build, and dependency audit are also
run and required in pull-request CI.

## Initial findings register

| ID        | Finding and evidence                                                                                                                                                       | Impact                                                                                                                                                      | Required follow-up                                                                                                                          | Priority |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-SEC-01  | `POST /api/officials/confirm` validates the invite token but does not select or compare the invited phone with `user.phone`. It then updates solely by official ID.        | Someone with a valid invite URL and another authenticated phone identity may be able to claim the invitation. Two simultaneous confirmations may also race. | Implement an atomic confirmation transaction/RPC that checks token, expiry, status, and verified phone; add mismatch and concurrency tests. | Critical |
| F-SEC-02  | The official route-group layout only checks that a role row exists for the tenant; it does not require `role = 'official'`.                                                | A user with another tenant role may access official routes, including official announcements.                                                               | Enforce a role permission matrix at route boundaries and test every disallowed role.                                                        | High     |
| F-SEC-03  | The architecture documents state that service role is never used for user-scoped tenant data, while the service-role client is used throughout route/page/action code.     | RLS is bypassed for these calls; a missed application-level check can become a tenant-data exposure. Documentation and implementation disagree.             | Migrate user-scoped access to the session client; isolate exceptional privileged operations behind a narrow API with review/tests.          | High     |
| F-SEC-04  | The announcements route selects all phone numbers and sends them concurrently. It does not filter officials who opted out of SMS.                                          | Violates the documented opt-out behaviour; creates abuse, cost, and provider-rate-limit risk.                                                               | Filter notification preferences, model participant preferences, and use a queued delivery/outbox flow with bounded concurrency.             | High     |
| F-SEC-05  | The dependency audit reported three high-severity production findings.                                                                                                     | Known vulnerabilities may be released.                                                                                                                      | Apply reviewed dependency upgrades, run regression tests, and make audit a merge/release gate.                                              | High     |
| F-PERF-01 | The scheduling page correctly pages beyond PostgREST's 1,000-row limit, but it still assembles every assignment for the tenant and passes the full collection to the grid. | Time, memory, and client rendering cost grow with the entire event rather than the user's current view.                                                     | Load-test the agreed event size; introduce stage/date/range queries and grid virtualisation or bounded pagination.                          | Medium   |
| F-PERF-02 | Schedule status updates are issued one at a time and related schedule edits are not one atomic database operation.                                                         | More round trips and partial-update risk under load or failure.                                                                                             | Move batch validation and mutation to a transaction/RPC; retain database constraints as the final concurrency guard.                        | Medium   |
| F-MNT-03  | The test suite is healthy at unit/component level, but no repository tests prove RLS against a real database or exercise the end-to-end OTP/invitation flow.               | The most important access-control behaviours are unproven in their deployed form.                                                                           | Add disposable-database integration tests and a staged end-to-end smoke test.                                                               | High     |
| F-MNT-04  | The production build depended on downloading Google Fonts in the assessment environment and warned about an inferred workspace root.                                       | Builds may be less deterministic; the warning can conceal unintended workspace boundaries.                                                                  | Make font loading and Turbopack root explicit; verify a clean build in CI.                                                                  | Medium   |
| F-MNT-05  | The scheduling grid component is approximately 1,100 lines.                                                                                                                | High cognitive load and higher regression risk in the product's most complex UI.                                                                            | Split domain calculation, state management, rendering, and interactions into focused modules with tests.                                    | Medium   |

## Resolved findings

| ID       | Resolution and evidence                                                                                                                                                              | Remaining follow-up                                                                                                                | Status                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| F-MNT-01 | The lint script uses `eslint .`, and `npm run lint` passed with no errors or warnings on 2026-08-11. The `Quality checks` workflow runs lint for pull requests and pushes to `main`. | The `Lint` status is selected as required in the `main` branch ruleset; save the ruleset and verify it on the next pull request.   | Automated; activation verification pending |
| F-MNT-02 | `npm run format:check` passed with no style issues on 2026-08-11. The `Quality checks` workflow runs formatting for pull requests and pushes to `main`.                              | The `Format` status is selected as required in the `main` branch ruleset; save the ruleset and verify it on the next pull request. | Automated; activation verification pending |

## Main branch ruleset

The GitHub ruleset shown in repository settings targets the default branch,
`main`. Once its changes are saved and the ruleset is active, it is configured
to enforce the following:

- Pull requests are required before merging, and the branch must be up to date.
- Required status checks: `Lint`, `Format`, and
  `Analyze Source Code (javascript-typescript)`.
- Force pushes are blocked.
- Code-scanning results at high severity or above are required.
- The bypass list is empty.

The ruleset currently requires zero approving reviews. Requiring one approval
is recommended when another maintainer is available, but is a product/team
decision rather than a technical prerequisite.

## Evidence references

- Invitation confirmation: [`src/app/api/officials/confirm/route.ts`](../src/app/api/officials/confirm/route.ts)
- Official route authorization: [`src/app/(official)/[tenantSlug]/layout.tsx`](<../src/app/(official)/[tenantSlug]/layout.tsx>)
- Service-role client: [`src/lib/supabase/server.ts`](../src/lib/supabase/server.ts)
- SMS announcement route: [`src/app/api/announcements/route.ts`](../src/app/api/announcements/route.ts)
- Schedule fetching and mutation: [`src/app/(tenant)/[tenantSlug]/admin/scheduling/page.tsx`](<../src/app/(tenant)/[tenantSlug]/admin/scheduling/page.tsx>) and [`actions.ts`](<../src/app/(tenant)/[tenantSlug]/admin/scheduling/actions.ts>)
- Dependency and local quality commands: [`package.json`](../package.json)
- Current SAST workflow: [`code-ql-analysis.yml`](../.github/workflows/code-ql-analysis.yml)
- Current lint and format workflow: [`quality.yml`](../.github/workflows/quality.yml)

## Recommended delivery sequence

1. **Before further external onboarding:** resolve F-SEC-01 through F-SEC-05 and add their regression tests.
2. **Before the next production release:** make MNT-01 and MNT-02 green in pull-request CI; add real-database RLS and role tests.
3. **Before the Viadal-scale event:** agree the capacity baseline, create representative seed data, run load tests, and address PERF-01 through PERF-04.
4. **Continuously:** review telemetry, CodeQL, dependency audit results, delivery failures, and quality-gate trends at each release.

## Definition of done for a quality requirement

A requirement is complete only when its implementation is merged, automated
verification passes in CI, the evidence is linked from the pull request or
release record, and any relevant operational dashboard or alert has been
verified in staging.
