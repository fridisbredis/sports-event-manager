import { z } from 'zod'

import { FEEDBACK_PAGE_PATH_MAX } from './feedback'

// N71: where a feedback page was opened from, as the nav link passes it in the
// query (?from=<path>&event=<uuid>). Both are untrusted URL input, so anything
// that is not a plain in-app path or a uuid is dropped rather than rejected:
// the page still works, the report just says less about where it came from.
// The insert policy re-checks that the event belongs to the tenant.

const pathSchema = z
  .string()
  .max(FEEDBACK_PAGE_PATH_MAX)
  // In-app only: "/club/admin", never "//evil.example" (protocol-relative)
  // or a full URL.
  .regex(/^\/(?!\/)/)

const eventSchema = z.string().uuid()

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseFeedbackOrigin(searchParams: Record<string, string | string[] | undefined>): {
  fromPath: string | null
  eventId: string | null
} {
  const from = pathSchema.safeParse(first(searchParams.from))
  const event = eventSchema.safeParse(first(searchParams.event))
  return {
    fromPath: from.success ? from.data : null,
    eventId: event.success ? event.data : null,
  }
}
