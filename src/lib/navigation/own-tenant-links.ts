import type { OwnTenantSurfaces } from '@/lib/auth/tenant'

// One tenant where the user holds a role of their own (B19, B20).
export type OwnTenantLink = {
  name: string
  href: string
  /** True when the row leads to the official view, not the admin view. */
  officialOnly: boolean
}

// getOwnTenantSurfaces as links: the admin view where the user is admin (its
// sidebar links on to the official view), else the official view.
//
// `excludeSlug` is the tenant the user is in. The system admin menu lists
// every tenant (B19); inside a tenant the list is "other organisations"
// (B20), so the current one is left out, and a user with one tenant gets an
// empty list and no section at all.
export function toOwnTenantLinks(
  surfaces: OwnTenantSurfaces[],
  excludeSlug?: string
): OwnTenantLink[] {
  return surfaces
    .filter((s) => s.slug !== excludeSlug)
    .map((s) => ({
      name: s.name,
      href: s.admin ? `/${s.slug}/admin` : `/${s.slug}/events`,
      officialOnly: !s.admin,
    }))
}
