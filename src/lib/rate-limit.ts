import { createSupabaseServiceClient } from '@/lib/supabase/server'

const PHONE_LIMIT = { limit: 3, windowSeconds: 3600 }
const ADMIN_LIMIT = { limit: 100, windowSeconds: 3600 }

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }

async function hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_duration_seconds: windowSeconds,
  })
  if (error || !data?.[0]) throw new Error('rate limit check failed', { cause: error })
  const row = data[0]
  return { allowed: row.allowed, retryAfterSeconds: Math.ceil(row.retry_after_ms / 1000) }
}

export async function checkInviteRateLimit(
  tenantId: string,
  phone: string,
  userId: string
): Promise<RateLimitResult> {
  const phoneKey = `invite:phone:${tenantId}:${phone}`
  const adminKey = `invite:admin:${userId}`

  // Phone checked first (narrower limit) and short-circuits on reject, so the
  // admin counter is never touched for a request already blocked on phone.
  // A request blocked on the admin check has still consumed a phone-side
  // point — accepted, deliberate asymmetry from this ordering choice.
  const phoneResult = await hit(phoneKey, PHONE_LIMIT.limit, PHONE_LIMIT.windowSeconds)
  if (!phoneResult.allowed) return phoneResult

  return hit(adminKey, ADMIN_LIMIT.limit, ADMIN_LIMIT.windowSeconds)
}

export async function releaseInviteRateLimit(tenantId: string, phone: string): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.rpc('release_rate_limit', {
      p_key: `invite:phone:${tenantId}:${phone}`,
    })
    if (error) {
      console.error(
        `Invite rate limit release failed for tenant ${tenantId} (cause: ${error.message})`
      )
    }
  } catch (err) {
    console.error(
      `Invite rate limit release threw for tenant ${tenantId} (cause: ${err instanceof Error ? err.message : String(err)})`
    )
  }
  // Best-effort: a failed release self-heals when the phone key's window expires.
  // The admin key is intentionally never released here: it is a 100/hour abuse-volume
  // ceiling that must charge on every attempt, not just successes. Refunding it on
  // failure would let an admin submit unlimited unsendable numbers for free.
}
