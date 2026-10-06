import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Shared with the Twilio probe below so the two budgets can't drift apart.
const PROBE_TIMEOUT_MS = 3000

export interface SupabaseStatus {
  status: 'ok' | 'error'
}

export async function fetchSupabaseStatus(): Promise<SupabaseStatus> {
  const supabase = createSupabaseServiceClient()

  try {
    const { error } = await Promise.race([
      supabase.from('tenants').select('id').limit(1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase probe timed out')), PROBE_TIMEOUT_MS)
      ),
    ])

    if (error) {
      logger.warn('Health dashboard: Supabase query failed', { error })
      return { status: 'error' }
    }

    return { status: 'ok' }
  } catch (error) {
    logger.warn('Health dashboard: Supabase probe timed out or threw', { error })
    return { status: 'error' }
  }
}

export interface TwilioStatus {
  status: 'ok' | 'error' | 'unknown'
  sentToday?: number
  /** The sender number sentToday is scoped to — shown in the UI so the
   *  count is never ambiguous between dev and prod. CLAUDE.md states both
   *  environments share one Twilio subaccount, but the two
   *  `*_TWILIO_ACCOUNT_SID` secret values have not been independently
   *  compared (see PR #110 review) — this claim rests on that document,
   *  not on a verified check. */
  fromNumber?: string
}

// Twilio Usage Records API is scoped to the account, not the Messaging
// Service. CLAUDE.md says dev and prod share one Twilio subaccount, which
// would mean it can't tell the two environments' sends apart — but that has
// not been independently confirmed (the `*_TWILIO_ACCOUNT_SID` secrets
// haven't been compared, see PR #110 review). The Messages list sidesteps
// the question either way: it takes a `From`
// filter, and each environment already has its own sender number
// (TWILIO_PHONE_NUMBER) reused here, no new secret needed.
//
// direction === 'outbound-api' excludes inbound (an inbound STOP reply must
// not inflate a card labelled "SMS idag" (sent)). DateSent> is a calendar
// day in UTC, not a rolling 24h window — the closest built-in match without
// computing our own boundary; a literal rolling window isn't worth it for a
// status card.
//
// Twilio's Messages resource has no field-selection or count-only endpoint
// (verified 2026-09-02 against the public API docs) — every message in the
// response carries `body`/`to`/`from` regardless of what we ask for, so
// this can't be made to request less PII on the wire than it already does.
// What we control is how much of it we hold in the app process: pages of
// MAX_PAGE_SIZE are counted and discarded one at a time via `next_page_uri`
// rather than pulling up to 1000 full message resources into one array, and
// PAGE_FETCH_LIMIT bounds worst-case latency/PII exposure on a real spike —
// past it we stop and report what we've counted so far rather than fetching
// indefinitely, so a spike undercounts instead of hanging the page.
const TWILIO_MAX_PAGE_SIZE = 50
const TWILIO_PAGE_FETCH_LIMIT = 5

export async function fetchTwilioStatus(): Promise<TwilioStatus> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER

  if (!accountSid || !authToken || !fromNumber) {
    return { status: 'unknown' }
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const today = new Date().toISOString().slice(0, 10)
    const timeoutSignal = AbortSignal.timeout(PROBE_TIMEOUT_MS)

    let sentToday = 0
    let nextUrl: string | null =
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?` +
      new URLSearchParams({
        From: fromNumber,
        // A bare date's inclusivity on `DateSent>` isn't documented by
        // Twilio — an exclusive boundary would silently read 0 every day
        // and look like a healthy card. Midnight UTC removes the ambiguity.
        'DateSent>': `${today}T00:00:00Z`,
        PageSize: String(TWILIO_MAX_PAGE_SIZE),
      })

    for (let page = 0; nextUrl && page < TWILIO_PAGE_FETCH_LIMIT; page++) {
      const response: Response = await fetch(nextUrl, {
        headers: { Authorization: `Basic ${auth}` },
        next: { revalidate: 60 },
        signal: timeoutSignal,
      })

      if (!response.ok) {
        logger.warn('Health dashboard: Twilio messages request failed', {
          error: new Error(`status ${response.status}`),
        })
        return { status: 'unknown' }
      }

      const data = (await response.json()) as {
        messages?: { direction?: string }[]
        meta?: { next_page_uri?: string | null }
      }
      sentToday += data.messages?.filter((m) => m.direction === 'outbound-api').length ?? 0
      nextUrl = data.meta?.next_page_uri ? `https://api.twilio.com${data.meta.next_page_uri}` : null
    }

    return { status: 'ok', sentToday, fromNumber }
  } catch (error) {
    logger.warn('Health dashboard: Twilio messages request threw', { error })
    return { status: 'unknown' }
  }
}

export interface SentryStatus {
  status: 'ok' | 'unknown'
  unresolvedCount?: number
}

// SENTRY_API_TOKEN reaches this process as a runtime env var via
// `az containerapp update --set-env-vars` in both deploy workflows. It is
// deliberately a *different* secret from the build-time SENTRY_AUTH_TOKEN
// Docker ARG used for source-map upload (see the Dockerfile comment and
// CLAUDE.md's secrets section): that one only needs `project:releases`,
// while this GET /issues/ call needs `project:read` (+ `org:read`) — scopes
// a release-upload token doesn't carry. Sharing one token for both purposes
// was tried during SYS-03 review and 403'd here. Falls back to 'unknown'
// rather than failing the page, same as the Twilio probe, since a missing
// token (e.g. local dev, where it's never set) is an expected, not
// exceptional, state.
//
// query=is:unresolved + statsPeriod=24h answers "is anything actively wrong
// right now", which is what a status page needs — not a lifetime issue
// count, which would only ever grow and say nothing about current health.
//
// This endpoint paginates (default 25/page via a Link header); per_page=100
// covers the volume a two-tenant MVP should ever see and this counts one
// page rather than following pagination, so — same tradeoff as the Twilio
// probe above — a real spike would undercount, not hang the page.
export async function fetchSentryStatus(): Promise<SentryStatus> {
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  const token = process.env.SENTRY_API_TOKEN

  if (!org || !project || !token) {
    return { status: 'unknown' }
  }

  try {
    const params = new URLSearchParams({
      query: 'is:unresolved',
      statsPeriod: '24h',
      per_page: '100',
    })
    const response = await fetch(
      `https://sentry.io/api/0/projects/${org}/${project}/issues/?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    )

    if (!response.ok) {
      logger.warn('Health dashboard: Sentry issues request failed', {
        error: new Error(`status ${response.status}`),
      })
      return { status: 'unknown' }
    }

    const issues = (await response.json()) as unknown[]
    return { status: 'ok', unresolvedCount: issues.length }
  } catch (error) {
    logger.warn('Health dashboard: Sentry issues request threw', { error })
    return { status: 'unknown' }
  }
}

export type WorkflowConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'skipped'
  | 'startup_failure'
  | 'stale'
  | 'running'

export interface WorkflowRun {
  /** The workflow file name, e.g. 'deploy-dev.yml' — the key the caller
   *  asked for, echoed back so a caller fanning out over several files can
   *  tell the results apart without relying on array order. */
  workflow: string
  conclusion: WorkflowConclusion
  /** ISO-8601, as GitHub returns it. Formatted for display at the UI edge,
   *  not here, so this stays serialisable across the server/client boundary. */
  startedAt: string
  /** Deep link to the run itself, so a failure is one click from its log. */
  url: string
}

export interface GitHubActionsStatus {
  status: 'ok' | 'error' | 'unknown'
  runs?: WorkflowRun[]
}

// The repo is public, so this reads workflow runs unauthenticated: no new
// secret, and no change to either deploy workflow. The cost is GitHub's
// 60-requests-per-hour-per-IP unauthenticated limit, which the 60s
// `revalidate` below keeps well clear of — the page is system-admin-only and
// all visitors share one cached result per minute.
//
// If this ever starts reporting 'unknown' from rate limiting (or the repo
// goes private), the fix is additive: set GITHUB_API_TOKEN as a runtime env
// var the way SENTRY_API_TOKEN already is and send it as a Bearer header
// here. Nothing else in this function changes, which is why the token is
// read optionally rather than being required up front.
const GITHUB_REPO = 'fridisbredis/sports-event-manager'
const DEPLOY_WORKFLOWS = ['deploy-dev.yml', 'deploy-prod.yml'] as const

// Which conclusions count as "the deploy is broken". Exported because the
// card tints the same rows red that drive the badge here — keeping one set
// means the badge and the row colour can never disagree. A cancelled or
// skipped run is deliberately not a failure: those are usually a superseded
// push, not something to wake up for.
export const FAILED_CONCLUSIONS: ReadonlySet<WorkflowConclusion> = new Set([
  'failure',
  'timed_out',
  'startup_failure',
])

export async function fetchGitHubActionsStatus(): Promise<GitHubActionsStatus> {
  const token = process.env.GITHUB_API_TOKEN

  try {
    const runs = await Promise.all(
      DEPLOY_WORKFLOWS.map(async (workflow): Promise<WorkflowRun | null> => {
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/runs?per_page=1`,
          {
            headers: {
              Accept: 'application/vnd.github+json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            next: { revalidate: 60 },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          }
        )

        if (!response.ok) {
          logger.warn('Health dashboard: GitHub workflow runs request failed', {
            error: new Error(`status ${response.status} for ${workflow}`),
          })
          return null
        }

        const data = (await response.json()) as {
          workflow_runs?: {
            conclusion?: string | null
            html_url?: string
            run_started_at?: string
          }[]
        }
        const run = data.workflow_runs?.[0]
        if (!run) return null

        return {
          workflow,
          // An in-progress run has conclusion: null until it finishes —
          // reporting that as a failure would make every deploy look broken
          // while it is still running, so it gets its own value instead.
          conclusion: (run.conclusion ?? 'running') as WorkflowConclusion,
          startedAt: run.run_started_at ?? '',
          url: run.html_url ?? `https://github.com/${GITHUB_REPO}/actions/workflows/${workflow}`,
        }
      })
    )

    const found = runs.filter((run): run is WorkflowRun => run !== null)

    // A partial result is still worth showing: if dev answered and prod
    // didn't, the dev row is real information. Only a total blank is
    // 'unknown', matching how the Twilio and Sentry probes degrade.
    if (found.length === 0) return { status: 'unknown' }

    const hasFailure = found.some((run) => FAILED_CONCLUSIONS.has(run.conclusion))

    return { status: hasFailure ? 'error' : 'ok', runs: found }
  } catch (error) {
    logger.warn('Health dashboard: GitHub workflow runs request threw', { error })
    return { status: 'unknown' }
  }
}
