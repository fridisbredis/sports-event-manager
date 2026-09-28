import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

// The permission matrix, asserted through the UI.
//
// The integration suite already proves RLS blocks cross-tenant *data* access.
// What it cannot see is whether a screen is reachable: guards live in layouts
// and pages (there is no middleware.ts), so a missing getAdminTenant() call
// would leak an admin screen to an official while every RLS test stays green.
// These tests are that second line of defence.

const ADMIN_PATHS = [
  `/${SEED_TENANT_SLUG}/admin/dashboard`,
  `/${SEED_TENANT_SLUG}/admin/event`,
  `/${SEED_TENANT_SLUG}/admin/officials`,
  `/${SEED_TENANT_SLUG}/admin/scheduling`,
  `/${SEED_TENANT_SLUG}/admin/communication`,
  `/${SEED_TENANT_SLUG}/admin/workstations`,
  `/${SEED_TENANT_SLUG}/admin/account`,
]

const SYSTEM_PATHS = ['/admin', '/admin/health']

const OFFICIAL_PATHS = [
  `/${SEED_TENANT_SLUG}/home`,
  `/${SEED_TENANT_SLUG}/event-info`,
  `/${SEED_TENANT_SLUG}/schedule`,
  `/${SEED_TENANT_SLUG}/announcements`,
  `/${SEED_TENANT_SLUG}/account`,
]

// A blocked page renders Next.js's not-found body. Matching on the response
// status instead of on copy keeps this from breaking when the 404 page is
// restyled or translated.
async function expectNotFound(page: import('@playwright/test').Page, path: string) {
  const response = await page.goto(path)
  expect(response?.status(), `${path} should not be reachable`).toBe(404)
}

async function expectReachable(page: import('@playwright/test').Page, path: string) {
  const response = await page.goto(path)
  expect(response?.status(), `${path} should be reachable`).toBe(200)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
}

test.describe('signed out', () => {
  for (const path of [...ADMIN_PATHS, ...SYSTEM_PATHS, ...OFFICIAL_PATHS]) {
    test(`${path} redirects to /login`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
    })
  }

  test('API routes answer 401 rather than redirecting', async ({ request }) => {
    // src/proxy.ts splits on the /api prefix: browsers get a redirect, API
    // clients get JSON. A redirect here would hand a fetch() caller an HTML
    // login page with a 200.
    const response = await request.post('/api/announcements', { data: {} })
    expect(response.status()).toBe(401)
  })
})

test.describe('official', () => {
  for (const path of ADMIN_PATHS) {
    test(`cannot reach ${path}`, async ({ officialConfirmedPage }) => {
      await expectNotFound(officialConfirmedPage, path)
    })
  }

  for (const path of SYSTEM_PATHS) {
    test(`cannot reach ${path}`, async ({ officialConfirmedPage }) => {
      await expectNotFound(officialConfirmedPage, path)
    })
  }

  for (const path of OFFICIAL_PATHS) {
    test(`can reach ${path}`, async ({ officialConfirmedPage }) => {
      await expectReachable(officialConfirmedPage, path)
    })
  }
})

test.describe('tenant admin', () => {
  for (const path of SYSTEM_PATHS) {
    test(`cannot reach ${path}`, async ({ tenantAdminPage }) => {
      await expectNotFound(tenantAdminPage, path)
    })
  }

  for (const path of ADMIN_PATHS) {
    test(`can reach ${path}`, async ({ tenantAdminPage }) => {
      await expectReachable(tenantAdminPage, path)
    })
  }

  // resolveOfficialSurfaceAccess admits tenant_admins to the official surfaces
  // too — OFF-01 puts the admin on the roster as implicitly confirmed, so they
  // are expected to see their own shifts.
  //
  // F-MNT-20: ACCT-01 used to be excluded from this loop. It renders from an
  // `officials` row and calls notFound() when there is none, and the tenant
  // admin had a user_roles row only, so it 404'd while every other official
  // surface resolved. ensure_admin_roster_row (migration 20260911130436) plus
  // the backfill (20260911130546) give the admin that row, so the whole set is
  // reachable and the filter this loop used to carry is gone.
  for (const path of OFFICIAL_PATHS) {
    test(`can reach ${path}`, async ({ tenantAdminPage }) => {
      await expectReachable(tenantAdminPage, path)
    })
  }

  test('cannot reach another tenant', async ({ tenantAdminPage }) => {
    // getAdminTenant() resolves the slug against this user's roles, so an
    // unknown tenant is indistinguishable from one they lack access to.
    await expectNotFound(tenantAdminPage, '/some-other-club/admin/dashboard')
  })
})

test.describe('system admin', () => {
  for (const path of SYSTEM_PATHS) {
    test(`can reach ${path}`, async ({ systemAdminPage }) => {
      await expectReachable(systemAdminPage, path)
    })
  }

  // is_system_admin() is the mandatory OR clause in every tenant-scoped RLS
  // policy (CLAUDE.md), and hasAdminAccessToTenant grants the same global
  // access in the app layer — a system admin reaches a tenant's screens
  // without a user_roles row for it.
  for (const path of ADMIN_PATHS) {
    test(`can reach ${path}`, async ({ systemAdminPage }) => {
      await expectReachable(systemAdminPage, path)
    })
  }
})
