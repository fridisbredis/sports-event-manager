import { createHash } from 'crypto'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { AuthEventType } from '@/types/app'
import type { Json } from '@/types/database'

export type LogAuthEventInput = {
  phone: string
  event: AuthEventType
  actorUserId?: string | null
  // Nullable because most auth_events writes (OTP send/verify) don't know a
  // tenant yet — see migration 0038's header. role_granted_via_invite_confirmation
  // (0042) is the first event that does, and populates it.
  tenantId?: string | null
  errorCode?: string | null
  detail?: Record<string, unknown>
}

// Same canonicalize-then-hash as rate-limit.ts's loginPhoneRateLimitKey, so a
// raw phone number is never written to this table (GDPR retention — see
// migration 0038's header). Deliberately not shared code with rate-limit.ts:
// that hash feeds a rate-limit bucket key, this one an audit row, and the two
// are allowed to diverge independently without either caller noticing.
function hashPhone(phone: string): string {
  const canonical = phone.replace(/\D/g, '')
  return createHash('sha256').update(canonical).digest('hex')
}

// Uses the service client, not the session client logAuditEvent() uses —
// see docs/adr/0001-service-role-vs-session-client.md category 5. A failed
// OTP verify has no auth.uid() to satisfy an RLS INSERT policy with, so
// there is no session-client path that could work here even in principle.
//
// Fail-safe by design, matching logAuditEvent(): called only after the real
// Supabase Auth call has already happened, never on its critical path. A
// write failure here must never change the login response.
export async function logAuthEvent(input: LogAuthEventInput): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.from('auth_events').insert({
      phone_hash: hashPhone(input.phone),
      event: input.event,
      actor_user_id: input.actorUserId ?? null,
      tenant_id: input.tenantId ?? null,
      error_code: input.errorCode ?? null,
      detail: (input.detail ?? {}) as Json,
    })

    if (error) {
      logger.error('Failed to write auth event', error, { event: input.event })
    }
  } catch (err) {
    logger.error('Auth event write threw unexpectedly', err, { event: input.event })
  }
}
