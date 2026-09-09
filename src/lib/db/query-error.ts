import { logger } from '@/lib/logger'

/**
 * Observability for failed Supabase queries in server actions and route
 * handlers (REL-03).
 *
 * PR #76 (F-REL-10) fixed the page-component half of this: reads that
 * destructured only `data` and coalesced a failure into `?? []`, so a broken
 * migration or an RLS regression rendered a normal-looking empty screen and
 * Sentry saw nothing. That change explicitly did not survey server actions or
 * route handlers, and both classes of the same defect were still there:
 *
 *   1. The error reaches control flow but never a log — the caller gets a 500
 *      or an error string, and nothing reaches Sentry or Log Analytics. The
 *      operator sees "Update failed" in the UI with no way to find out why.
 *   2. The error is not destructured at all — a write is fire-and-forget, or a
 *      read's failure is indistinguishable from an empty table.
 *
 * Both are invisible rather than loud, which is what makes them worse than a
 * crash: REL-02's Sentry coverage only ever saw the errors that throw.
 *
 * Why a helper rather than a bare `logger.error` per call site: the fields have
 * to be the same shape everywhere for a Log Analytics query (or a Sentry alert)
 * to select on them. Same reasoning as `checkReadCeiling` in
 * ./bounded-read.ts.
 */

interface QueryErrorContext {
  /** Where this ran — `POST /api/officials`, `publishEvent`. */
  op: string
  /** Table, view, or RPC name the query addressed. */
  table: string
  /** select | insert | update | delete | rpc */
  kind: 'select' | 'insert' | 'update' | 'delete' | 'rpc'
  tenantId?: string
  /** Anything else worth selecting on. Never a phone number or raw user input. */
  extra?: Record<string, unknown>
}

/**
 * A PostgrestError-shaped value. Deliberately structural rather than importing
 * `PostgrestError`: `.auth.admin.*` and `.auth.getUser()` return `AuthError`,
 * which carries `code`/`message` but not `details`/`hint`, and both go through
 * this helper.
 */
interface QueryErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

/**
 * The Postgres error code is the field worth alerting on — `42703`
 * (undefined_column) and `42P01` (undefined_table) mean schema drift, `42501`
 * means an RLS policy is refusing the write, `23505` a unique violation. They
 * are stable, low-cardinality, and safe to log.
 *
 * `message`/`details`/`hint` are logged too, because without them a `42501` in
 * Log Analytics does not say which policy. They are Postgres-generated and can
 * quote a *column* value back — which is why call sites must not route errors
 * from queries filtered on a phone number through `extra`, and why nothing here
 * ever logs the query's own filter values.
 */
export function logQueryError(error: unknown, ctx: QueryErrorContext): void {
  const e = (error ?? {}) as QueryErrorLike

  logger.error(`${ctx.op}: ${ctx.kind} on ${ctx.table} failed`, error, {
    op: ctx.op,
    table: ctx.table,
    kind: ctx.kind,
    pgCode: e.code ?? 'none',
    ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
    ...ctx.extra,
  })
}
