import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

export interface SupabaseStatus {
  status: 'ok' | 'error'
}

export async function fetchSupabaseStatus(): Promise<SupabaseStatus> {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('tenants').select('id').limit(1)

  if (error) {
    logger.error('Health dashboard: Supabase query failed', error)
    return { status: 'error' }
  }

  return { status: 'ok' }
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
export async function fetchTwilioStatus(): Promise<TwilioStatus> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    return { status: 'unknown' }
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/Today.json?Category=sms`,
      {
        headers: { Authorization: `Basic ${auth}` },
        next: { revalidate: 60 },
        signal: AbortSignal.timeout(3000),
      }
    )

    if (!response.ok) {
      logger.error(
        'Health dashboard: Twilio usage request failed',
        new Error(`status ${response.status}`)
      )
      return { status: 'unknown' }
    }

    const data = (await response.json()) as { usage_records?: { count?: string }[] }
    const sentToday = data.usage_records?.reduce((sum, r) => sum + Number(r.count ?? 0), 0) ?? 0

    return { status: 'ok', sentToday }
  } catch (error) {
    logger.error('Health dashboard: Twilio usage request threw', error)
    return { status: 'unknown' }
  }
}
