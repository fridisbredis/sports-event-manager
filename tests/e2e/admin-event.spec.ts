import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

// EVT-01 Event dashboard and EVT-02 Event configuration.
// Role: tenant admin (a system admin reaches these too — access-control.spec.ts
// covers that; here the point is the behaviour, so one role is enough).

const DASHBOARD = `/${SEED_TENANT_SLUG}/admin/dashboard`
const EVENT_CONFIG = `/${SEED_TENANT_SLUG}/admin/event`

test.describe('EVT-01 dashboard', () => {
  test('summarises the event and its publish state', async ({ tenantAdminPage: page }) => {
    await page.goto(DASHBOARD)

    // The h1 is the event name itself; the seed names it 'Seed Race 2026'.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    for (const section of ['Publish Status', 'Officials', 'Scheduling Warnings', 'Admin Areas']) {
      await expect(page.getByRole('heading', { name: section })).toBeVisible()
    }

    // Draft/Published chip — one or the other, never both.
    const chips = page.getByText(/^(Draft|Published)$/)
    await expect(chips.first()).toBeVisible()
  })

  test('officials card counts invited and confirmed separately', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(DASHBOARD)

    // The seed creates one invited official (+46709900003) alongside the
    // confirmed ones, so both counters have something to show.
    await expect(page.getByText('Invited')).toBeVisible()
    await expect(page.getByText('Confirmed')).toBeVisible()
  })

  test('scheduling warnings card reports over-capacity and double-booked', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(DASHBOARD)
    await expect(page.getByText('Over capacity')).toBeVisible()
    await expect(page.getByText('Double-booked')).toBeVisible()
  })

  // The six nav tiles are the dashboard's job as a hub: every admin screen has
  // to be reachable from here without typing a URL.
  const TILES: [string, string][] = [
    ['Event configuration', '/admin/event'],
    ['Work areas', '/admin/workstations'],
    ['Officials', '/admin/officials'],
    ['Scheduling', '/admin/scheduling'],
    ['Communication', '/admin/communication'],
    ['Account', '/admin/account'],
  ]

  for (const [name, path] of TILES) {
    test(`links to ${name}`, async ({ tenantAdminPage: page }) => {
      await page.goto(DASHBOARD)
      // Each screen is linked twice: once from the sidebar (inside <aside>) and
      // once from the Admin Areas grid. The grid is what this test is about, so
      // exclude the sidebar rather than taking .first(), which is the sidebar.
      await page
        .locator(`a:not(aside a)`, { hasText: new RegExp(`^${name}`) })
        .first()
        .click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    })
  }
})

test.describe('EVT-02 event configuration', () => {
  test('shows the identity and schedule blocks', async ({ tenantAdminPage: page }) => {
    await page.goto(EVENT_CONFIG)

    await expect(page.getByRole('heading', { name: 'Event configuration' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Schedule & Setup' })).toBeVisible()

    await expect(page.getByLabel('Event name')).toBeVisible()
    await expect(page.getByLabel('Type', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Description')).toBeVisible()
  })

  test('rejects an empty event name on save', async ({ tenantAdminPage: page }) => {
    await page.goto(EVENT_CONFIG)

    const name = page.getByLabel('Event name')
    const original = await name.inputValue()
    await name.fill('')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Event name cannot be empty.')).toBeVisible()

    // Restore, so the shared seed tenant is left as it was found — the suite
    // runs against one tenant and later tests read this value.
    await name.fill(original)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  })

  test('saves an edited event name and keeps it after reload', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(EVENT_CONFIG)

    const name = page.getByLabel('Event name')
    const original = await name.inputValue()
    const edited = `${original} (e2e)`

    await name.fill(edited)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()

    // A round-trip through the server is the only proof the write landed;
    // the button label alone is optimistic client state.
    await page.reload()
    await expect(page.getByLabel('Event name')).toHaveValue(edited)

    await page.getByLabel('Event name').fill(original)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  })

  test('stage modal shows distance fields for Race and hides them for Non-race', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(EVENT_CONFIG)
    await page.getByRole('button', { name: '+ Add stage' }).click()

    const modal = page.getByRole('dialog')
    // HeroUI's ModalHeader renders a plain div, so there is no heading role to
    // match here — the title is just text inside the dialog.
    await expect(modal.getByText('Add stage')).toBeVisible()

    // Race exposes the category/distance block…
    await modal.getByRole('button', { name: 'Race', exact: true }).click()
    await expect(modal.getByText('Category type')).toBeVisible()

    // …Non-race replaces it with the explanatory hint.
    await modal.getByRole('button', { name: 'Non-race', exact: true }).click()
    await expect(
      modal.getByText('Distance(s) and formal start/end apply to Race stages only.')
    ).toBeVisible()

    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
  })

  test('stage modal requires a name', async ({ tenantAdminPage: page }) => {
    await page.goto(EVENT_CONFIG)
    await page.getByRole('button', { name: '+ Add stage' }).click()

    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: 'Save stage' }).click()
    await expect(modal.getByText('Name is required.')).toBeVisible()

    await modal.getByRole('button', { name: 'Cancel' }).click()
  })

  test('warns when navigating away with unsaved changes', async ({ tenantAdminPage: page }) => {
    await page.goto(EVENT_CONFIG)

    const name = page.getByLabel('Event name')
    const original = await name.inputValue()
    await name.fill(`${original} unsaved`)

    // The guard intercepts in-app navigation, so use a sidebar link rather
    // than page.goto() — a direct navigation bypasses the router entirely.
    await page.getByRole('link', { name: 'Dashboard' }).click()

    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText('You have unsaved changes. If you leave, your changes will be lost.')
    ).toBeVisible()

    // Staying keeps both the page and the edit.
    await dialog.getByRole('button', { name: 'Stay' }).click()
    await expect(page).toHaveURL(new RegExp(`${EVENT_CONFIG}$`))
    await expect(name).toHaveValue(`${original} unsaved`)

    // Leaving discards it — and the value is untouched on the server, so no
    // cleanup is needed here.
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Leave anyway' }).click()
    await expect(page).toHaveURL(new RegExp('/admin/dashboard$'))
  })
})
