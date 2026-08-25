import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // No PII: phone numbers and names pass through this codebase constantly
  // (officials, participants, announcements). Sentry must never become a
  // second place those live.
  sendDefaultPii: false,
})
