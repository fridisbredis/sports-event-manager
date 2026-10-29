import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG, EVENT_SEGMENT } from './fixtures/users'

// N23 / TEN-01, the tenant dashboard. Read-only on purpose: archiving the
// seed event would pull it out from under every other spec running in
// parallel. Archive and un-archive are covered by the action's unit tests and
// by tests/integration/tenant-events.test.ts against the real cap trigger.

const LIST = `/${SEED_TENANT_SLUG}/admin`

test.describe('TEN-01 tenant dashboard', () => {
  test("lists the tenant's events and opens one", async ({ tenantAdminPage: page }) => {
    await page.goto(LIST)

    await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible()
    const card = page.getByRole('listitem').filter({ hasText: 'Seed Race 2026' })
    await expect(card.getByText('Published')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Actions for Seed Race 2026' })).toBeVisible()

    await card.getByRole('link', { name: 'Seed Race 2026' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/${EVENT_SEGMENT}/dashboard$`))
  })

  test('shows the event links only inside an event', async ({ tenantAdminPage: page }) => {
    const sidebar = page.locator('aside')

    await page.goto(LIST)
    await expect(sidebar.getByRole('link', { name: 'All events' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)

    await page.goto(`${LIST}/dashboard`)
    await expect(page).toHaveURL(new RegExp(`/admin/${EVENT_SEGMENT}/dashboard$`))
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible()

    await sidebar.getByRole('link', { name: 'All events' }).click()
    await expect(page).toHaveURL(new RegExp(`${LIST}$`))
  })

  test('filters by status', async ({ tenantAdminPage: page }) => {
    await page.goto(LIST)
    await page.getByRole('link', { name: 'Archived', exact: true }).click()

    await expect(page).toHaveURL(/\?status=archived$/)
    await expect(page.getByText('No archived events')).toBeVisible()
    await expect(page.getByRole('link', { name: /Seed Race 2026/ })).toHaveCount(0)
  })
})
