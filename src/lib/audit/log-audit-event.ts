import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import type { AuditAction, AuditActorRole, AuditTargetType } from '@/types/app'
import type { Json } from '@/types/database'

export type LogAuditEventInput = {
  tenantId: string | null
  actorUserId: string
  actorRole: AuditActorRole
  action: AuditAction
  targetType: AuditTargetType
  targetId?: string | null
  detail?: Record<string, unknown>
}

// Fail-safe by design, matching logger.ts's philosophy (see
// announcements/route.ts, officials/route.ts): an audit-write failure must
// never throw out of a caller or change the caller's response. Every call
// site here calls this only after its real mutation has already succeeded —
// the audit row is a side effect, not a precondition. Failures are logged
// loudly via logger.error (never silently dropped) so missing audit
// coverage is visible in monitoring, not just in a security review months
// later.
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.from('audit_events').insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      // detail is a plain JSON-safe object at every call site; the DB
      // column type is generic jsonb (Json), which Record<string, unknown>
      // isn't structurally assignable to.
      detail: (input.detail ?? {}) as Json,
    })

    if (error) {
      logger.error('Failed to write audit event', error, {
        action: input.action,
        tenantId: input.tenantId,
      })
    }
  } catch (err) {
    logger.error('Audit event write threw unexpectedly', err, {
      action: input.action,
      tenantId: input.tenantId,
    })
  }
}
