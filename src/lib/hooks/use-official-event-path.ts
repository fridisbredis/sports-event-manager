'use client'

import { useParams } from 'next/navigation'
import { officialEventPath } from '@/lib/events/paths'

// N23: builds a path to an official screen of the event in the current URL.
// Only for components rendered beneath /[tenantSlug]/events/[eventId].
export function useOfficialEventPath(): (subpath?: string) => string {
  const { tenantSlug, eventId } = useParams<{ tenantSlug: string; eventId: string }>()
  return (subpath = '') => officialEventPath(tenantSlug, eventId, subpath)
}
