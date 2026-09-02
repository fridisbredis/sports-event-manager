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
// not inflate a card labelled "SMS idag" (sent)). DateSent>= is a calendar
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
        'DateSent>': today,
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
