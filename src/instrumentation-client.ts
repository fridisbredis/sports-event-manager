import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  // Only built app images report. `next dev` on a laptop used to send to the
  // dev project under the same 'development' environment tag the Azure dev
  // deploy uses, burying real dev-environment errors under local compile
  // errors and half-edited files. NODE_ENV is what tells them apart: every
  // Docker build is 'production', whatever SENTRY_ENVIRONMENT it carries.
  enabled: process.env.NODE_ENV === 'production',
  tracesSampleRate: 0.1,
  // No PII: phone numbers and names pass through this codebase constantly
  // (officials, participants, announcements). Sentry must never become a
  // second place those live.
  sendDefaultPii: false,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
