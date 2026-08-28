# Operational readiness — PERF-05

This is a runbook, not a design doc. It is written for whoever is paging
through a production incident and did not write any of this — so it leads
with what to do, and explains *why* each piece is wired the way it is,
rather than only *what* is wired.

**Contents**

1. Status
2. Prerequisites
3. What is monitored, and where
4. Probes
5. Alerts — what each means and what to do
6. Restarts vs. deploys — unverified
7. When to re-run `set-probes.sh`
8. Health-check cron
9. Replica configuration
10. The PERF-01 residual
11. Known gaps

## 1. Status

PERF-05 lands as **configured and documented, load-verification residual**
— it is not fully met yet. Probes, alerts, and the replica floor described
below are in place and reviewed, but the requirement cannot be marked met
until the PERF-01 load test produces a per-replica capacity figure (section
10). Read everything below with that residual in mind: this describes a
system that is configured correctly by inspection, not one that has been
proven correct under load.

## 2. Prerequisites

Running any of the `scripts/ops/*.sh` scripts requires the **Azure CLI
(`az`)** and **`jq`** on the operator's machine. Neither tool was available
on the machine where these scripts were authored.

As a direct consequence: **neither `scripts/ops/set-probes.sh` nor
`scripts/ops/create-alerts.sh` has ever been executed.** They are written,
reviewed artifacts, not battle-tested ones. Read a script in full before
running it for the first time, and treat that first real run as a first
run, not a formality. `set-probes.sh` mitigates this partially by taking
its own backup and requiring confirmation before applying anything (section
7).

**`create-alerts.sh` is safe on a FIRST run only — it is not idempotent.**
The two `create` calls behave differently, and an earlier version of this
section claimed they were the same:

- `az monitor action-group create` **does** upsert on name + resource group.
  Safe to re-run — but "upsert" there means REPLACE, not MERGE: a recipient
  added by hand in the Azure portal is silently dropped on the next run. The
  script has a receiver check that requires confirmation when it finds more
  receivers than it is about to set.
- `az monitor metrics alert create` **does not** upsert. It errors on an
  existing alert name; changing an existing alert needs `az monitor metrics
  alert update`.

So a re-run aborts at the first metric alert under `set -euo pipefail`,
before the remaining two alerts and before the script's own VERIFY block —
leaving alerting **partly** configured, and reporting failure without saying
which parts landed. Either delete the three `alert-sem-prod-*` alerts by
name before re-running, or fix the script to gate each alert on an existence
check. Do not re-run and assume the errors are benign.

`[UNVERIFIED]` The create-vs-update asymmetry above is taken from the az CLI's
documented behaviour, not observed — no `az` was available on the machine
that wrote these scripts. Confirm with `az monitor metrics alert create --help`
and `az monitor metrics alert update --help` before the first re-run. If
`create` does upsert after all, correct this section and the script header
together — they were allowed to disagree once already.

## 3. What is monitored, and where

No new metrics code was written for PERF-05, deliberately — the platform
already exposes what is needed:

- **Azure Monitor** already collects, per Container App: `Requests` (with a
  `StatusCodeCategory` dimension), `Replicas`, CPU/memory, and
  `RestartCount`. This is what the three alerts in section 5 read from.
- **Sentry** (`tracesSampleRate: 0.1`) already gives p95 latency per route.
- **Database metrics** come from Supabase's own Reports dashboard.

No new Application Insights resource was created, or is needed — Azure
Monitor's built-in Container App metrics cover what PERF-05 requires.

## 4. Probes

Probes are configured directly on the **Container App resource**, by hand,
via `scripts/ops/set-probes.sh`. They are **not** set by the deploy
workflow, and the Dockerfile `HEALTHCHECK` instruction is **not** a
production probe — see below.

**Why probes target `/api/health/live` and not `/api/health`:** in Azure
Container Apps, a **readiness** probe failure *restarts the replica* — it
does not just pull it out of rotation the way a failed readiness probe
would in vanilla Kubernetes. If probes were pointed at the DB-backed
`/api/health`, a Supabase outage would fail readiness on every replica at
once; ACA would restart all of them; they would come back up, immediately
fail the same DB check, and restart again — turning a partial outage
(database down, app otherwise fine) into a total one (app never stable
enough to serve anything). `/api/health/live` makes no Supabase call, so
probe health and database health are deliberately decoupled. The
database-down signal still needs to reach someone — that is the job of the
5xx-count alert in section 5, not a probe.

**The Dockerfile `HEALTHCHECK` provides no production probe coverage.**
Azure Container Apps never reads a Dockerfile `HEALTHCHECK` instruction —
it only applies to a local `docker run`. Do not credit it with protecting
prod; it protects nothing there.

**Defaults, and why the script sets values explicitly:** when no `probes`
array is configured at all, ACA's implicit default is a TCP check on the
ingress target port, with a startup grace of `failureThreshold: 240` /
`periodSeconds: 1` (~4 minutes). The moment any `probes` array is defined
explicitly — which `set-probes.sh` does, to repoint probes at
`/api/health/live` — every field not set explicitly falls back to the API's
own, much shorter default instead of that implicit ~4-minute grace. The
script sets `STARTUP_FAILURE_THRESHOLD=10` / `STARTUP_PERIOD_SECONDS=24`
explicitly so that defining probes does not silently shrink the startup
grace. That is the same 240 seconds as ACA's implicit default, expressed as
10 × 24s rather than 240 × 1s: the ARM schema (ContainerApps 2025-07-01,
`ContainerAppProbe`) caps `failureThreshold` at 10, so 240 is not a legal
value for that field even though it is the implicit default's own. Do not
"restore" `STARTUP_FAILURE_THRESHOLD=240` — the script's bounds check
rejects it and exits 1 before touching prod.
This matters concretely: shrinking the grace would recreate the Phase 5
incident documented in the root `CLAUDE.md` ("Probe of StartUp failed with
status code: 1"), where prod's cold start took longer than the probe
allowed and Azure fell back to the hello-world placeholder revision.
Liveness and readiness probes are set to steady-state values
(`failureThreshold: 3`, `periodSeconds: 10` — 30 seconds of consecutive
failures) rather than the cold-start allowance; keep these conservative,
since — per the paragraph above — a readiness failure restarts the replica
rather than just derotating it, so a flaky `/api/health/live` under load
would cause avoidable restarts, not just avoidable derotation.

## 5. Alerts — what each means and what to do

Three metric alerts, wired to one shared email action group
(`scripts/ops/create-alerts.sh`, recipient supplied via a required
`ALERT_EMAIL` variable with no default):

- **5xx count ≥ 2 within 15 minutes.** This is a **count**, not a rate — a
  rate would be diluted by healthy traffic on a low-traffic app and could
  mask a real problem. **2 in 15 minutes can mean two unrelated blips, not
  necessarily a single incident** — before escalating, check whether the
  errors share a route and a time cluster. This alert is also how a
  **Supabase/database outage surfaces**: `/api/health` returns 503 when
  Supabase is unreachable, that 503 passes through Azure ingress and is
  counted as a 5xx, and this same alert catches it. There is deliberately
  no separate database-outage alert.
- **Replicas at max (3), sustained for 15 minutes.** **This threshold is
  unvalidated.** Nobody knows whether normal peak load legitimately reaches
  3 replicas, because the PERF-01 load test that would answer that has
  never run (section 10). Do not mistake the first time this fires for a
  confirmed capacity event — it may just mean the threshold needs
  revisiting.
- **RestartCount ≥ 3 within 15 minutes.** A crash-loop signal — see section
  6 for how to distinguish this from a normal deploy.

**Caveat carried from the script:** the exact dimension-filter keyword for
the 5xx `StatusCodeCategory` condition (`includes`) could not be verified
against a live `az` CLI while writing `create-alerts.sh` — it is commented
as unverified at that line in the script. Azure's dimension-filter syntax
has differed across CLI versions/docs (e.g. `Include` / `IncludeAny`
elsewhere). If the alert-create call fails with a parse error on
`--condition`, check `az monitor metrics alert create --help` for the
current keyword. Confirm this on the first real run.

## 6. Restarts vs. deploys — unverified

Both Container Apps run in **single revision mode**, so a deploy creates a
**new revision with new replicas**, rather than restarting replicas that
are already running. The expectation that follows is: `RestartCount`
should **not** spike on a normal deploy.

**This expectation could not be verified.** `az` was unavailable while this
branch was written, and so was web access to Azure Container Apps' own
metric documentation. Treat it as an expectation, not a confirmed fact,
until someone checks it against a real deploy.

Practical guidance until then: if the restart alert fires, correlate the
restart timestamps against revision-creation time and recent deploy
timestamps before concluding it is a crash loop. A cluster of restarts that
lines up with a deploy is more likely to be deploy churn (or worth a second
look at *why* single-revision mode produced restarts instead of a clean new
revision); a cluster with no nearby deploy is more likely to be a genuine
crash loop.

## 7. When to re-run `set-probes.sh`

Probes are **one-time configuration on the running Container App
resource**, set outside the deploy pipeline entirely. A normal
`az containerapp update --image ...` deploy preserves them. But if the
Container App is ever **recreated** rather than updated, probes silently
revert to ACA's TCP default (section 4) — and nobody finds out until the
next incident makes it obvious.

This is not hypothetical here: the prod Container App was originally
created from a hello-world placeholder image, which is how it ended up on
`--target-port 80` and needed a manual `az containerapp ingress update` to
fix (root `CLAUDE.md`, Phase 5 lessons learned). The same class of mistake
— a resource getting recreated with defaults instead of updated — is
exactly what would silently drop the probe configuration.

**Re-run `set-probes.sh` after:**

- Any Container App recreation.
- Any `--yaml`-based change applied to the Container App (a full-resource
  `--yaml` apply can overwrite fields that were not in the file being
  applied).
- As a verification step in the rollback rehearsal routine
  (`docs/testing/rollback-rehearsal.md` — cross-referenced here, not
  modified by this document).

**To confirm current probe config without changing anything**, read it
back directly:

```bash
az containerapp show \
  --name sports-event-manager-prod \
  --resource-group sports-event-manager-prod-rg \
  --query "properties.template.containers[0].probes" \
  --output jsonc
```

Prefer this read-back over assuming probes are still correctly set.

**Why probes are not set inside the deploy workflow:** Azure Container Apps
has no dedicated CLI flags for health probes — they can only be set by
supplying a full resource definition via `--yaml`. `az containerapp create
--yaml <file>` is documented to say *"All other parameters will be
ignored."* If a deploy job ever ran something like `az containerapp create
--yaml probes.yaml --image myimage:$SHA` in that shape, the `--image` value
would be silently dropped and the job could exit 0 without actually
deploying the new image — a green deploy that did not deploy.

**Word this precisely, because it matters for anyone extending this
script:** that "all other parameters ignored" behaviour is *documented* for
`az containerapp create --yaml`. It is **unverified** for
`az containerapp update --yaml` — the `update` reference page was never
checked while this was written, so do not treat it as a known `update`
gotcha. `set-probes.sh` protects itself regardless of which way that turns
out, by exporting the app's current live configuration first and building
the probe change on top of that export, rather than applying a hand-written
YAML file from scratch. Anyone wiring probe-setting into automation, or
otherwise extending this script, should run `az containerapp update --help`
and read the current docs for `--yaml` first rather than assume either
direction.

## 8. Health-check cron

`.github/workflows/health-check.yml` runs on a `*/5 * * * *` schedule (plus
manual `workflow_dispatch`) and issues three `curl` calls per run against
`${{ secrets.PROD_APP_URL }}/api/health`.

This targets a **different** endpoint than the probes, deliberately — note
the difference so the next person does not "fix" this into consistency and
silently delete the database alarm in the process:

- **Probes** hit `/api/health/live` because a probe failure *restarts a
  replica* (section 4) — they must never depend on the database.
- **The cron** hits `/api/health` because a check failure here is *only a
  signal*, not an action — nothing restarts because this workflow fails.

Three curls per run exist so that a **single** cron run can clear the "≥ 2
in 15 minutes" 5xx alert threshold on its own — the alert does not depend
on two separate GitHub Actions cron runs landing inside the same
15-minute window, which matters because `*/5` schedules drift in practice
(5–15 minutes between runs is normal for GitHub-hosted cron, not the
exception).

**Which signal is authoritative depends on the failure mode.** For a
partial failure — app up, serving 5xx, database unreachable, `/api/health`
returning 503 — the Azure 5xx metric alert (section 5) is authoritative;
this workflow's own GitHub notification is a secondary signal only,
useful but not the one to trust over the Azure alert if they disagree.

For a **total outage** — app stopped, revision never activates, ingress
broken — this cron is the **primary and only** signal. All three Azure
metric alerts created by `create-alerts.sh` are static-threshold metric
alerts, and a static-threshold alert with no incoming data does not
fire — it holds its previous state instead of evaluating to true. Walked
through per alert: the 5xx alert needs `Requests` data with
`StatusCodeCategory = 5xx`, and a stopped app records no requests at all;
the replica-saturation alert's condition is `min Replicas >= 3`, and a
stopped app sits at 0 replicas, so the condition is false rather than
triggered; the crash-loop alert needs `RestartCount` data, and a stopped
app records none. In a total outage, none of the three Azure alerts
fire — this cron is the only thing that will.

**This check does not exist yet.** A GitHub Actions `schedule:` trigger
only runs once the workflow file is on the repository's default branch.
`health-check.yml` currently lives only on `feat/PERF-05-metrics-alerting`
— until this branch merges to `main`, this cron does not run, and prod
has no outage detector at all, because (as above) the Azure metric alerts
are blind to total outage. This is not a footnote: "documented" here does
not mean "monitored" until the merge happens.

**GitHub auto-disables scheduled workflows after 60 days of repository
inactivity**, and they must then be re-enabled manually from the Actions
UI. This is a silent failure mode — the workflow simply stops running,
with no notification that it was disabled — and because the Azure alerts
are blind to total outage (above), a silently-disabled cron would leave
prod with no outage detector at all until someone notices.

**Failure owner:** Frida Bredberg — named as the required reviewer on the
prod deploy approval gate (`environment: production` in
`deploy-prod.yml`) — *confirm with the team*. Assigning operational
on-call ownership is a human decision this document cannot make on its
own; this is a starting proposal, not a settled assignment.

**Whether the failure notification actually reaches anyone is
unverified.** This document assumes a failing workflow run surfaces
somewhere a person reads — GitHub's default failed-workflow email, most
likely — but that path has not been confirmed for this repository or for
whoever ends up as failure owner. Treat "the cron will fail loudly" as
unverified until someone checks, same as the failure-owner assignment
above — *confirm with the team*.

## 9. Replica configuration

Prod is now `--min-replicas 2 --max-replicas 3` (previously `min 1`).

**Min 2** buys redundancy against replica failure and node drain, at the
cost of a permanently doubled always-on container floor — roughly double
the baseline compute and memory spend, all the time, not just under load.
Min 2 does not change baseline database load: the app uses `@supabase/ssr`
over HTTPS to PostgREST — no `pg`, no Prisma, no pooler configuration, no
realtime subscriptions. An idle replica opens zero database connections;
PostgREST owns the server-side connection pool, and connection pressure
scales with concurrent request volume, not replica count. Put plainly:
**min 2 buys redundancy against replica failure and node drain at the cost
of a permanently doubled container floor; it does not change baseline
database load, because the app holds no persistent Postgres connections.**

**Max 3 is provisional**, not a measured ceiling. It was held at 3 rather
than raised further because 3 and 10 would be equally invented numbers
without load data — and a higher ceiling widens the pool of concurrent
connections PostgREST has to serve. The replicas-at-max alert (section 5)
is what makes holding at 3 safe in the meantime: if prod is genuinely
saturating 3 replicas, that alert fires and says so, rather than the
ceiling silently limiting throughput with no one noticing.

**Explicit revisit trigger:** when the PERF-01 load test yields a real
per-replica capacity figure, set the max-replica ceiling from that data,
not from this placeholder.

## 10. The PERF-01 residual

**PERF-01's acceptance criterion is locked and already documented** — it is
not an open question. It reads: p95 response time is at most 300% of that
test case's own unloaded-instance baseline. This was confirmed by the
product owner, Peter Thorn, on 2026-08-25, and lives in
`docs/quality-requirements.md`:

- Method: lines 90–100.
- Ceiling (300%): lines 102–106.
- The prior open question about the ceiling is struck through and marked
  resolved at lines 292–293.

Do not re-open that question, and do not describe the criterion itself as
unresolved or missing — it is not. What remains open is narrower and
separate:

**Acceptance criterion locked; volume inputs still pending from the
product owner (`quality-requirements.md:111-115`).** Use that phrasing,
cited by line range, rather than a count of how many inputs are pending —
two independent sources have already miscounted this, and a line range
survives someone adding another figure later while a count just goes
stale. For orientation only (not a substitute for the citation): confirmed
inputs are 20 officials and 5 concurrent tenant-admin sessions; pending
inputs cover work areas, assignments, concurrent read-only
official/participant sessions, and the announcement audience.

**Passing PERF-01 will not mean the app is fast.** The criterion measures
*degradation under load relative to that test case's own baseline*, not
absolute latency. A test case with a slow unloaded baseline can stay
within 300% of itself and still be slow in absolute terms.

This connects directly to the provisional replica-at-max threshold
discussed in section 9: PERF-01's method divides a loaded figure by an
unloaded one measured on the same instance, so the ratio only holds if
replica configuration is identical across both runs. PERF-05 changes prod
from min 1 to min 2, and dev's replica config is hand-set in Azure and
unreadable from source. **Whoever runs PERF-01 must record the actual
replica count at test time, or the ratio is not reproducible.** This is
stated nowhere else in the docs today.

This is a live reason the dev/prod replica-configuration gap matters for
PERF-01's numbers — it is **not** an instruction to close that gap. The
gap is a known, deliberately deferred item and is **not fixed on this
branch**. `.github/workflows/deploy-dev.yml` is not edited by this
document, no edit to it is proposed here, and it is not described here as
something this branch resolves.

## 11. Known gaps

Everything below is unverified or unresolved as of this document, collected
in one place so nothing here gets mistaken for a confirmed fact on a
second read:

- Whether `RestartCount` genuinely stays flat across a normal deploy
  (section 6) — not verified, `az` was unavailable.
- Whether `az containerapp update --yaml` silently drops unspecified
  parameters the way `create --yaml` is documented to (section 7) — not
  verified either way.
- The exact dimension-filter keyword (`includes`) for the 5xx
  `StatusCodeCategory` alert condition (section 5) — not verified against
  a live `az` CLI.
- The replica-at-max threshold of 3 (section 5, section 9) — provisional,
  not derived from measured load.
- Neither `scripts/ops/set-probes.sh` nor `scripts/ops/create-alerts.sh`
  has ever been executed (section 2) — both are reviewed, unrun artifacts.
- Whether a failing run of `health-check.yml` actually reaches a
  person — the default GitHub Actions failure notification is assumed
  but not confirmed (section 8).
- `health-check.yml`'s `schedule:` trigger is not live yet — it only runs
  once this branch merges to `main` (section 8). Strike this bullet once
  merged.
- The structural fix for the total-outage detection gap (section 8) would
  be a log-search alert that fires on absent data rather than a static
  metric threshold — not proposed or scoped here, deferred as a separate
  decision.
