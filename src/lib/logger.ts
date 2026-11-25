// Structured JSON logging to stdout/stderr. Azure Container Apps ships
// container logs to Log Analytics automatically, so no transport/SDK is
// needed to get these queryable in `ContainerAppConsoleLogs_CL`.
//
// logger.error also reports to Sentry (REL-02), so every existing call site
// gets error tracking without being touched again. The report is best-effort
// and wrapped so a Sentry SDK failure can never throw out of a log call —
// several call sites depend on "logging must never be able to change the
// response" (see announcements/route.ts, officials/route.ts).

import * as Sentry from '@sentry/nextjs'

type LogContext = Record<string, unknown>

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  if (error && typeof error === 'object') {
    return error as Record<string, unknown>
  }
  return { message: String(error) }
}

// Phone numbers are stored in E.164 (+46…, SEC-04). A Postgres error can echo
// one back ("Key (tenant_id, phone)=(…, +4670…) already exists"). stdout keeps
// it — that stays in our own Log Analytics — but Sentry is a third party, and
// sendDefaultPii: false does not cover fields we put in extra ourselves.
const E164 = /\+\d{7,15}/g

function maskForSentry(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(E164, '[phone]') : value,
    ])
  )
}

function write(level: 'info' | 'warn' | 'error', message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  info(message: string, context?: LogContext) {
    write('info', message, context)
  },
  warn(message: string, context?: LogContext) {
    write('warn', message, context)
  },
  error(message: string, error?: unknown, context?: LogContext) {
    write('error', message, {
      ...context,
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    })

    // An Error is reported as itself (Sentry keeps its stack). Anything else —
    // notably a supabase-js PostgrestError, which is a plain object — is
    // reported as new Error(message), so the issue still groups by the log
    // message, with the original's fields in extra. Without that, Sentry got
    // only the message and the code/details were lost (B25: the cause of
    // VIADAL-EVENT-PROD-3 was only found in Log Analytics).
    const isError = error instanceof Error
    try {
      Sentry.captureException(isError ? error : new Error(message), {
        extra: {
          message,
          ...context,
          ...(error !== undefined && !isError
            ? { error: maskForSentry(serializeError(error)) }
            : {}),
        },
      })
    } catch {
      // A Sentry SDK failure must never escape a log call.
    }
  },
}
