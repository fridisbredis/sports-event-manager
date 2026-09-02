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
}

// Twilio Usage Records API — reuses the same account credentials the app
// already sends SMS with, no new secret needed. Falls back to 'unknown' so a
// Twilio outage or credential issue never breaks the whole dashboard page.
//
// Usage Records buckets are calendar days in the account's reporting
// timezone, not a rolling window — "Today" is the closest built-in match to
// "how much SMS activity has there been recently". A literal rolling 24h
// count isn't available from this endpoint without paging through
// individual Message resources, which is unnecessary cost for a status page.
//
// Category=sms-outbound, not the sms parent category: the parent rolls up
// sms-inbound too, so an inbound STOP reply would inflate a number the UI
// labels "SMS idag" (sent). This is scoped to the account, not the Messaging
// Service, so if dev and prod ever share a Twilio subaccount this figure
// includes both environments' sends — see the review discussion on PR #110.
export async function fetchTwilioStatus(): Promise<TwilioStatus> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    return { status: 'unknown' }
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/Today.json?Category=sms-outbound`,
      {
        headers: { Authorization: `Basic ${auth}` },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    )

    if (!response.ok) {
      logger.warn('Health dashboard: Twilio usage request failed', {
        error: new Error(`status ${response.status}`),
      })
      return { status: 'unknown' }
    }

    const data = (await response.json()) as { usage_records?: { count?: string }[] }
    const sentToday =
      data.usage_records?.reduce((sum, r) => {
        const count = Number(r.count ?? 0)
        return sum + (Number.isFinite(count) ? count : 0)
      }, 0) ?? 0

    return { status: 'ok', sentToday }
  } catch (error) {
    logger.warn('Health dashboard: Twilio usage request threw', { error })
    return { status: 'unknown' }
  }
}
