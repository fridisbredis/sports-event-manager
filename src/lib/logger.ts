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

    try {
      Sentry.captureException(error instanceof Error ? error : new Error(message), {
        extra: { message, ...context },
      })
    } catch {
      // A Sentry SDK failure must never escape a log call.
    }
  },
}
