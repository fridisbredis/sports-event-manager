import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

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
    await page.getByRole('button', { name: 'Create tenant' }).first().click()

    const modal = page.getByRole('dialog')
    const create = modal.getByRole('button', { name: 'Create' })
    await expect(create).toBeDisabled()

    await modal.getByLabel('Race name').fill('E2E Provisioning Check')

    // The slug preview replaces the description text as soon as a name exists —
    // this is the operator's only sight of the URL before committing.
    await expect(modal.getByText(/URL slug:/)).toBeVisible()
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
  async function gotoSeedTenant(page: Page): Promise<void> {
    await page.goto('/admin')
    await page.getByRole('row').filter({ hasText: SEED_TENANT_SLUG }).getByRole('link').click()
    await expect(page).toHaveURL(/\/admin\/[0-9a-f-]{36}$/)
  }

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
    await expect(page.locator('input[type="radio"][name="tier"]:checked')).toHaveCount(1)
    await expect(page.getByRole('radio', { name: 'Standard' })).toBeChecked()

    await expect(
      page.getByText(
        'Exactly one tier is active per tenant in v1. Selecting one clears the others.'
      )
    ).toBeVisible()
  })

  test('deactivating a tenant is reflected in the list', async ({ systemAdminPage: page }) => {
    await gotoSeedTenant(page)

    const toggle = page.getByRole('switch')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText('The tenant cannot access its event workspace.')).toBeVisible()

    await page.goto('/admin')
    await expect(
      page.getByRole('row').filter({ hasText: SEED_TENANT_SLUG }).getByText('Inactive')
    ).toBeVisible()

    // Reactivate: an inactive tenant locks its own admins out
    // (requireTenantAdmin refuses inactive tenants), which would break every
    // other spec in this suite.
    await gotoSeedTenant(page)
    await page.getByRole('switch').click()
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })
})
