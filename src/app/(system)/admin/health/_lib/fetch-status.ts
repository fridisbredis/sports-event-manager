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
  sentLast24h?: number
  failedLast24h?: number
}

// Twilio Usage Records API — reuses the same account credentials the app
// already sends SMS with, no new secret needed. Falls back to 'unknown' so a
// Twilio outage or credential issue never breaks the whole dashboard page.
export async function fetchTwilioStatus(): Promise<TwilioStatus> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) {
    return { status: 'unknown' }
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/Yesterday.json?Category=sms`,
      { headers: { Authorization: `Basic ${auth}` }, next: { revalidate: 60 } }
    )

    if (!response.ok) {
      logger.error(
        'Health dashboard: Twilio usage request failed',
        new Error(`status ${response.status}`)
      )
      return { status: 'unknown' }
    }

    const data = (await response.json()) as { usage_records?: { count?: string }[] }
    const sentLast24h = data.usage_records?.reduce((sum, r) => sum + Number(r.count ?? 0), 0) ?? 0

    return { status: 'ok', sentLast24h }
  } catch (error) {
    logger.error('Health dashboard: Twilio usage request threw', error)
    return { status: 'unknown' }
  }
}
