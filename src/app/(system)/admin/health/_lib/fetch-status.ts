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
   *  count is never ambiguous between dev and prod, since both share one
   *  Twilio subaccount (confirmed 2026-09-02, PR #110 review). */
  fromNumber?: string
}

// Twilio Usage Records API is scoped to the account, not the Messaging
// Service — and dev and prod share one Twilio subaccount (confirmed
// 2026-09-02, see the review discussion on PR #110), so it can't tell the
// two environments' sends apart. The Messages list can: it takes a `From`
// filter, and each environment already has its own sender number
// (TWILIO_PHONE_NUMBER) reused here, no new secret needed.
//
// direction === 'outbound-api' excludes inbound (an inbound STOP reply must
// not inflate a card labelled "SMS idag" (sent)). DateSent>= is a calendar
// day in UTC, not a rolling 24h window — the closest built-in match without
// computing our own boundary; a literal rolling window isn't worth it for a
// status card. PageSize=1000 is one request for the volumes documented in
// CLAUDE.md (single low hundreds/day at most) — this counts a page, it does
// not paginate, so a real spike would undercount rather than hang.
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
    const params = new URLSearchParams({
      From: fromNumber,
      'DateSent>': today,
      PageSize: '1000',
    })
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${params}`,
      {
        headers: { Authorization: `Basic ${auth}` },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    )

    if (!response.ok) {
      logger.warn('Health dashboard: Twilio messages request failed', {
        error: new Error(`status ${response.status}`),
      })
      return { status: 'unknown' }
    }

    const data = (await response.json()) as { messages?: { direction?: string }[] }
    const sentToday = data.messages?.filter((m) => m.direction === 'outbound-api').length ?? 0

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

// SENTRY_AUTH_TOKEN reaches this process as a runtime env var via
// `az containerapp update --set-env-vars` in both deploy workflows — a
// separate channel from the build-time Docker ARG of the same name used for
// source-map upload (see the Dockerfile comment and CLAUDE.md's secrets
// section). Falls back to 'unknown' rather than failing the page, same as
// the Twilio probe, since a missing token (e.g. local dev, where it's never
// set) is an expected, not exceptional, state.
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
  const token = process.env.SENTRY_AUTH_TOKEN

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
