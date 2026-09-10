import { getServerTranslation } from '@/lib/i18n/server'
import { logger } from '@/lib/logger'

// F-REL-22: never forward a raw Postgres/PostgREST/Storage error.message to
// the client — it is untranslated developer prose (constraint names, quoted
// identifiers, sometimes caller-supplied UUIDs) that leaks past the CLAUDE.md
// "never expose raw errors" rule. Log the real error server-side and return a
// translated, stable string instead — mirrors the pattern already used in
// api/auth/send-otp and verify-otp (log message+code, return a mapped code).
//
// PostgREST error objects don't carry a stable TS type, so this takes the
// minimal shape every call site already has: an ERRCODE-bearing `code` and
// the raw `message` for logging.
interface DbErrorLike {
  code?: string | null
  message: string
}

// P0003 (custom, migration 20260910115206) discriminates the Race-stage
// removal guard from event_stages_times_order_check, which also raises 23514
// from the same sync_event_stages call — see that migration's header. Both
// enforcement points of that invariant use P0003: the guard inside
// sync_event_stages, and the deferred constraint trigger
// enforce_published_event_has_race_stage that catches direct writes
// bypassing the RPC (migration 20260909133414).
const DB_ERROR_KEYS: Record<string, string> = {
  P0002: 'eventConfig.eventNotFound',
  P0003: 'eventConfig.cannotRemoveLastRaceStage',
  '23514': 'eventConfig.stageTimesInvalid',
}

export async function translateDbError(
  logMessage: string,
  error: DbErrorLike,
  fallbackKey = 'eventConfig.genericSaveError',
  // Per-call-site overrides for a code otherwise absent from DB_ERROR_KEYS
  // (or that means something different at this call site than it does
  // elsewhere) — e.g. 23514 means "stage times out of order" for
  // sync_event_stages but "publish preconditions unmet" for publish_event.
  // Checked before DB_ERROR_KEYS so a call site can override a shared
  // mapping, not just add a code it's missing. Note this is only for codes
  // whose meaning the call site actually knows: fallbackKey must stay a
  // generic message, since it catches codes the app can't interpret at all.
  codeOverrides?: Record<string, string>,
  // `log: false` for a code the call site already logged (or deliberately
  // chose not to log) through `logQueryError` — publishEvent's P0002 is an
  // ordinary 404 rather than a failure, and its other codes get the richer
  // structured context (op/table/kind/tenantId) that REL-03 alerts select on.
  // Without this, those call sites would emit a second, thinner log line for
  // the same error.
  options?: { log?: boolean }
): Promise<string> {
  if (options?.log !== false) {
    logger.error(logMessage, undefined, { code: error.code, message: error.message })
  }
  const t = await getServerTranslation('en', 'admin')
  const key = codeOverrides?.[error.code ?? ''] ?? DB_ERROR_KEYS[error.code ?? ''] ?? fallbackKey
  return t(key)
}

export async function translateStorageError(
  logMessage: string,
  error: DbErrorLike
): Promise<string> {
  logger.error(logMessage, undefined, { message: error.message })
  const t = await getServerTranslation('en', 'admin')
  return t('eventConfig.logoUploadError')
}
