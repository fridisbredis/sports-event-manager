import type { Page } from '@playwright/test'
import { test, expect, clickWhenInteractive } from './fixtures/auth'
import { SEED_TENANT_SLUG, TOGGLE_TENANT_SLUG } from './fixtures/users'

// SYS-01 tenant management and SYS-02 tenant detail.
// Role: system admin — the only role that reaches these at all.

test.describe('SYS-01 tenant management', () => {
  test('lists every tenant on the platform', async ({ systemAdminPage: page }) => {
    await page.goto('/admin')

    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible()

    // HeroUI's Table renders role="grid", not role="table".
    const grid = page.getByRole('grid', { name: 'Tenants' })
    await expect(grid).toBeVisible()
    await expect(grid.getByText(SEED_TENANT_SLUG)).toBeVisible()
  })

  test('links to system status', async ({ systemAdminPage: page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: 'System status' }).click()
    await expect(page).toHaveURL(/\/admin\/health$/)
  })

  test('create-tenant modal previews the slug and can be cancelled', async ({
    systemAdminPage: page,
  }) => {
    await page.goto('/admin')

    const modal = page.getByRole('dialog')
    await clickWhenInteractive(page.getByRole('button', { name: 'Create tenant' }).first(), modal)

    const create = modal.getByRole('button', { name: 'Create' })
    await expect(create).toBeDisabled()

    await modal.getByLabel('Race name').fill('E2E Provisioning Check')

    // The slug preview replaces the description text as soon as a name exists —
    // this is the operator's only sight of the URL before committing.
    await expect(modal.getByText(/URL slug:/)).toBeVisible()

    // N20: a name alone is no longer enough. A tenant created without an admin
    // cannot be signed in to by anyone, so the first admin is required here
    // rather than left to a follow-up visit to SYS-02 that gets forgotten.
    await expect(create).toBeDisabled()

    await modal.getByLabel('Name', { exact: true }).fill('E2E First Admin')
    await expect(create).toBeDisabled()

    await modal.getByLabel('Phone number').fill('709900123')
    await expect(create).toBeEnabled()

    // Cancel rather than create: a real tenant would persist across runs and
    // accumulate in the list. Creation itself is covered by
    // tests/integration/create-tenant-atomicity.test.ts, which can roll back.
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
    await expect(page.getByText('E2E Provisioning Check')).toHaveCount(0)
  })

  test('opens a tenant from the list', async ({ systemAdminPage: page }) => {
    await page.goto('/admin')
    await page.getByRole('grid', { name: 'Tenants' }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/)
  })
})

test.describe('SYS-02 tenant detail', () => {
  // Resolve the seed tenant's detail URL rather than hardcoding an id. The row
  // link carries the tenant's *name*; the slug sits in a sibling paragraph, so
  // find the row by slug and then click the link inside it.
  async function gotoTenant(page: Page, slug: string): Promise<void> {
    await page.goto('/admin')
    await page.getByRole('row').filter({ hasText: slug }).getByRole('link').click()
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/)
  }

  const gotoSeedTenant = (page: Page) => gotoTenant(page, SEED_TENANT_SLUG)

  test('shows activation state and feature tier', async ({ systemAdminPage: page }) => {
    await gotoSeedTenant(page)

    await expect(page.getByRole('heading', { name: 'Activation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Feature tier' })).toBeVisible()

    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  // SYS-02's rule is "exactly one tier active, never zero or two" — the screen
  // offers standard/premium/professional as mutually exclusive radios rather
  // than independent toggles.
  //
  // Read-only on purpose: only `standard` is used in v1, so this asserts the
  // single-select invariant on the tier the tenant already has instead of
  // switching to a tier nobody runs. Switching is exercised at the action
  // level in src/app/(system)/admin/actions.test.ts, which needs no live
  // tenant to leave in a changed state.
  test('feature tier is single-select with exactly one active', async ({
    systemAdminPage: page,
  }) => {
    await gotoSeedTenant(page)

    await expect(page.locator('input[type="radio"][name="tier"]')).toHaveCount(3)
    // Exactly one, whichever it is. Asserting 'standard' specifically made this
    // fail the moment someone changed the seed tenant's tier by hand on the
    // shared dev stack — and the claim this test exists to make is that the
    // tiers are single-select, not that the seed ships a particular one.
    await expect(page.locator('input[type="radio"][name="tier"]:checked')).toHaveCount(1)

    await expect(
      page.getByText('A tenant has exactly one tier. Selecting a tier replaces the current one.')
    ).toBeVisible()
  })

  // The per-tier feature lists are generated from TIER_FEATURES, so this also
  // guards against the register and the UI drifting apart: standard unlocks
  // nothing tier-specific, and the colour theme appears from premium up.
  test('each tier lists the features it unlocks', async ({ systemAdminPage: page }) => {
    await gotoSeedTenant(page)

    await expect(page.getByText('No tier-specific features.')).toBeVisible()
    await expect(page.getByText('Includes: Event colour theme')).toHaveCount(2)
  })

  // Against its own throwaway tenant, not the seed one. Deactivating a tenant
  // locks out its admins for as long as it is off (requireTenantAdmin refuses
  // an inactive tenant), so doing that to the shared seed tenant breaks
  // whatever else is running — which is what pinned the suite to a single
  // worker. TOGGLE_TENANT_SLUG carries no data and nothing else reads it.
  test('deactivating a tenant is reflected in the list', async ({ systemAdminPage: page }) => {
    await gotoTenant(page, TOGGLE_TENANT_SLUG)

    const toggle = page.getByRole('switch')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText('The tenant cannot access its event workspace.')).toBeVisible()

    await page.goto('/admin')
    await expect(
      page.getByRole('row').filter({ hasText: TOGGLE_TENANT_SLUG }).getByText('Inactive')
    ).toBeVisible()

    // Put it back, so a rerun starts from the active state this asserts the
    // transition out of. global-setup resets it too, for a run that dies here.
    await gotoTenant(page, TOGGLE_TENANT_SLUG)
    await page.getByRole('switch').click()
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})

// The system-admin rail is a fixed 256px that does not shrink, which left
// 134px of a 390px phone for the page itself. It is hidden below md and
// replaced by a drawer opened from the top bar, so these run at a phone.
test.describe('system admin on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the rail gives way to a drawer in the top bar', async ({ systemAdminPage: page }) => {
    await page.goto('/admin')

    await expect(page.getByRole('complementary')).toBeHidden()

    await page.getByRole('button', { name: 'Open menu' }).click()

    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    // Everything the rail carries, including the footer links — a phone user
    // who can reach the tenant list but not log out is only half served.
    await expect(drawer.getByRole('link', { name: 'Tenants' })).toBeVisible()
    await expect(drawer.getByRole('link', { name: /Privacy policy/ })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('the drawer marks the page you are on and closes on navigation', async ({
    systemAdminPage: page,
  }) => {
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Open menu' }).click()

    const drawer = page.getByRole('dialog')
    const tenants = drawer.getByRole('link', { name: 'Tenants' })
    await expect(tenants).toHaveAttribute('aria-current', 'page')

    await tenants.click()
    await expect(drawer).toBeHidden()
  })

  // What the whole change is for: the page had 134px to render in, so the
  // tenant list was a column of clipped text.
  test('the tenant list gets the full width, with no sideways scroll', async ({
    systemAdminPage: page,
  }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible()

    const { clientWidth, scrollWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  })

  // Four columns is one too many for a phone. Activate/deactivate also lives
  // on the tenant's own page, which the name links to, so dropping the column
  // here makes nothing unreachable.
  test('the actions column is dropped, and the table still lines up', async ({
    systemAdminPage: page,
  }) => {
    await page.goto('/admin')

    await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeHidden()
    await expect(page.getByRole('columnheader', { name: 'Tenant' })).toBeVisible()

    // Header and body must hide the same column or the two halves misalign.
    // HeroUI promotes the first cell of each row to rowheader, so a count of
    // gridcells alone is one short of the column count by design.
    const headers = await page.getByRole('columnheader').filter({ visible: true }).count()
    const row = page.getByRole('row').nth(1)
    const cells =
      (await row.getByRole('gridcell').filter({ visible: true }).count()) +
      (await row.getByRole('rowheader').filter({ visible: true }).count())
    expect(cells).toBe(headers)
  })

  test('the rail is back on desktop, with no menu button', async ({ systemAdminPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/admin')

    await expect(page.getByRole('complementary')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
  })
})
