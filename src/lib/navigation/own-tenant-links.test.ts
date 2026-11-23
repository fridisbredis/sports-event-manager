import { describe, it, expect } from 'vitest'
import { toOwnTenantLinks } from './own-tenant-links'

const surfaces = [
  { slug: 'a-klubben', name: 'A-klubben', admin: true, official: true },
  { slug: 'b-klubben', name: 'B-klubben', admin: false, official: true },
  { slug: 'c-klubben', name: 'C-klubben', admin: true, official: false },
]

describe('toOwnTenantLinks', () => {
  // B19: admin view where the user is admin (its sidebar links on to the
  // official view), else the official view.
  it('links the admin view where the user is admin, else the official view', () => {
    expect(toOwnTenantLinks(surfaces)).toEqual([
      { name: 'A-klubben', href: '/a-klubben/admin', officialOnly: false },
      { name: 'B-klubben', href: '/b-klubben/events', officialOnly: true },
      { name: 'C-klubben', href: '/c-klubben/admin', officialOnly: false },
    ])
  })

  // B20: inside a tenant, the list is "other organisations" — the one the
  // user is already in would be a link to where they are.
  it('leaves out the tenant the user is in', () => {
    expect(toOwnTenantLinks(surfaces, 'b-klubben').map((l) => l.name)).toEqual([
      'A-klubben',
      'C-klubben',
    ])
  })

  it('is empty for a user with one tenant, once that tenant is left out', () => {
    expect(toOwnTenantLinks([surfaces[0]], 'a-klubben')).toEqual([])
  })
})
