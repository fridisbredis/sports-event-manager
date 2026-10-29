import { describe, it, expect } from 'vitest'
import { adminEventPath, adminEventRoutePattern } from './paths'

describe('adminEventPath', () => {
  it('builds the event root and a screen beneath it', () => {
    expect(adminEventPath('viadal', 'e1')).toBe('/viadal/admin/events/e1')
    expect(adminEventPath('viadal', 'e1', 'scheduling?day=2026-06-01')).toBe(
      '/viadal/admin/events/e1/scheduling?day=2026-06-01'
    )
  })

  it('does not double the slash when the subpath has one', () => {
    expect(adminEventPath('viadal', 'e1', '/officials')).toBe('/viadal/admin/events/e1/officials')
  })
})

describe('adminEventRoutePattern', () => {
  // revalidatePath matches on route files, so the pattern must keep the
  // literal [tenantSlug]/[eventId] segment names of the folders.
  it('names the route folders, not values', () => {
    expect(adminEventRoutePattern('workstations')).toBe(
      '/[tenantSlug]/admin/events/[eventId]/workstations'
    )
  })
})
