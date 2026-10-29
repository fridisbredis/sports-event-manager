'use client'

import { useParams } from 'next/navigation'
import { adminEventPath } from '@/lib/events/paths'

// N23: builds a path to a screen of the event the admin is looking at, from
// the [tenantSlug] and [eventId] segments of the current URL. Only for
// components rendered beneath /[tenantSlug]/admin/events/[eventId].
export function useAdminEventPath(): (subpath?: string) => string {
  const { tenantSlug, eventId } = useParams<{ tenantSlug: string; eventId: string }>()
  return (subpath = '') => adminEventPath(tenantSlug, eventId, subpath)
}
