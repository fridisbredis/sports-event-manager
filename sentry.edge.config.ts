import * as Sentry from '@sentry/nextjs'

// Covers src/proxy.ts, which runs on the edge runtime.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
})
