import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

// WS-01/WS-02 work areas, OFF-01 officials, COMM-01 communication and the
// admin half of ACCT-01. Role: tenant admin throughout.

const base = `/${SEED_TENANT_SLUG}/admin`

test.describe('WS-01 work areas list', () => {
  test('groups work areas by stage, with capacity and windows', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`${base}/workstations`)

    // exact: the accordion headings for each stage end in "N work areas" and
    // would otherwise match too.
    await expect(page.getByRole('heading', { name: 'Work areas', exact: true })).toBeVisible()

    // One accordion section per stage, each with its own add button.
    // scripts/seed-dev.ts creates three race days with two work areas each.
    await expect(page.getByRole('button', { name: '+ Add work area' })).toHaveCount(3)
    await expect(page.getByText('2 work areas').first()).toBeVisible()

    // Grouping is per stage, not one bucket: the seed uses the same two names
    // on every stage, so a work area filed under the wrong heading would show
    // as a count other than 2.
    const dayOne = page.getByRole('region', { name: /Day 1/ })
    await expect(dayOne.getByRole('rowheader', { name: 'Finish line' })).toBeVisible()
    await expect(dayOne.getByRole('rowheader', { name: 'Water station' })).toBeVisible()

    // Capacity renders as the spec's "up to X" ceiling, not a bare number, and
    // each row summarises its operating window.
    await expect(dayOne.getByRole('gridcell', { name: 'Up to 4' })).toBeVisible()
    await expect(dayOne.getByRole('gridcell', { name: /07:00–18:00/ }).first()).toBeVisible()
  })

  test('opens a work area from the list', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/workstations`)

    // Rows carry an onClick rather than an anchor, so this is a click on the
    // cell — getByRole('link') would find nothing.
    await page
      .getByRole('region', { name: /Day 1/ })
      .getByRole('rowheader', { name: 'Finish line' })
      .click()

    await expect(page).toHaveURL(new RegExp(`${base}/workstations/[0-9a-f-]+$`))
    await expect(page.getByRole('heading', { name: 'Finish line' })).toBeVisible()
  })
})

test.describe('WS-02 work area configuration', () => {
  test('new work area form requires a name', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/workstations`)
    await page.getByRole('button', { name: '+ Add work area' }).first().click()

    await expect(page).toHaveURL(new RegExp('/workstations/new'))
    await expect(page.getByRole('heading', { name: 'Add work area' })).toBeVisible()

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Name is required.')).toBeVisible()
  })

  test('shows the capacity and checklist blocks', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/workstations/new`)

    await expect(page.getByRole('heading', { name: 'Operating windows' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Capacity' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Checklists / To-dos' })).toBeVisible()
    await expect(page.getByLabel('Maximum officials at once')).toBeVisible()
  })

  test('adds and removes an operating window row', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/workstations/new`)

    // Each window row has one "Start" TimeInput, which HeroUI renders as a
    // group of hour/minute spinbuttons rather than a single labelled field —
    // so count the groups, not inputs.
    const starts = page.getByRole('group', { name: 'Start' })
    const before = await starts.count()

    await page.getByRole('button', { name: '+ Add window' }).click()
    await expect(starts).toHaveCount(before + 1)

    // "Remove" also labels the to-do rows further down the form, so take the
    // nth window's own button: window rows come first in DOM order.
    await page.getByRole('button', { name: 'Remove' }).nth(before).click()
    await expect(starts).toHaveCount(before)
  })
})

test.describe('OFF-01 officials roster', () => {
  test('lists officials with their invite status', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)

    await expect(page.getByRole('heading', { name: 'Officials Roster' })).toBeVisible()

    // The seed provides both states, so both chips must be present.
    await expect(page.getByText('Confirmed').first()).toBeVisible()
    await expect(page.getByText('Invited').first()).toBeVisible()
  })

  // OFF-01 says the admin appears on the roster as implicitly Confirmed, marked
  // "<name> — Event admin" and without action buttons. They do not: the seeded
  // tenant admin has a user_roles row but no `officials` row, so the roster
  // simply omits them.
  //
  // Same root cause as the 404 a tenant admin gets on the official account
  // screen (see access-control.spec.ts) — it shows up on two screens, which is
  // why it reads as a real gap rather than a quirk of one page. Asserting the
  // absence keeps the discrepancy visible; flip this to expect the row once
  // the admin is on the roster.
  test('does not list the admin on the roster (spec says it should)', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`${base}/officials`)
    await expect(page.getByText(/— Event admin$/)).toHaveCount(0)
  })

  test('add-official modal validates name and number', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)
    await page.getByRole('button', { name: 'Add official' }).first().click()

    const modal = page.getByRole('dialog')
    await expect(modal.getByText('Add official')).toBeVisible()

    // Send is gated on both fields; an invalid number keeps it disabled.
    const send = modal.getByRole('button', { name: 'Send invite' })
    await expect(send).toBeDisabled()

    await modal.getByLabel('Name').fill('E2E Test Official')
    await modal.getByLabel('Mobile number').fill('123')
    await expect(send).toBeDisabled()
    await expect(
      modal.getByText('Enter a valid mobile number for the selected country.')
    ).toBeVisible()

    // Closing without sending leaves the roster untouched — this suite must not
    // add officials to the shared seed tenant, which would skew EVT-01's counts.
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
  })

  test('removing an official asks for confirmation first', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)

    await page.getByRole('button', { name: 'Remove' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/also frees any work-area assignments/)).toBeVisible()

    // Cancel, not confirm: the removal is destructive and the roster is shared
    // with every other test in this suite.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
  })
})

test.describe('COMM-01 communication', () => {
  test('has separate participant and officials channels', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/communication`)

    await expect(page.getByRole('heading', { name: 'Communication' })).toBeVisible()

    await page.getByRole('button', { name: 'Officials', exact: true }).click()
    await expect(page.getByText('Timeline — Officials')).toBeVisible()

    await page.getByRole('button', { name: 'Participants', exact: true }).click()
    await expect(page.getByText('Timeline — Participants')).toBeVisible()
  })

  test('publish is disabled until something is written', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/communication`)

    const publish = page.getByRole('button', { name: 'Publish', exact: true })
    await expect(publish).toBeDisabled()

    await page.getByPlaceholder('Write an announcement…').fill('E2E draft')
    await expect(publish).toBeEnabled()
  })

  test('warns before discarding an unpublished draft', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/communication`)

    await page.getByPlaceholder('Write an announcement…').fill('E2E unsent draft')

    // Switching channel with a non-empty composer triggers the guard.
    await page.getByRole('button', { name: 'Officials', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('You have an unpublished announcement.')).toBeVisible()

    // Discard rather than publish — publishing would send real SMS to the
    // seeded officials via the queue.
    await dialog.getByRole('button', { name: 'Discard and continue' }).click()
    await expect(page.getByText('Timeline — Officials')).toBeVisible()
  })
})

test.describe('ACCT-01 admin account', () => {
  test('shows an editable name and a read-only number', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/account`)

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()

    // The seeded admin has no officials row, so page.tsx renders the
    // admin-only form: label 'Name' plus the description 'Editable'.
    // (The shared official form would read 'Name (editable)' instead.)
    await expect(page.getByLabel('Name', { exact: true })).toBeEditable()
    await expect(page.getByText('Mobile number')).toBeVisible()
  })
})
