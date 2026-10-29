import { test, expect, clickWhenInteractive } from './fixtures/auth'
import { SEED_TENANT_SLUG, EVENT_SEGMENT } from './fixtures/users'

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

    await expect(page).toHaveURL(new RegExp(`${base}/${EVENT_SEGMENT}/workstations/[0-9a-f-]+$`))
    await expect(page.getByRole('heading', { name: 'Finish line' })).toBeVisible()
  })
})

test.describe('WS-02 work area configuration', () => {
  test('new work area form requires a name', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/workstations`)
    await clickWhenInteractive(
      page.getByRole('button', { name: '+ Add work area' }).first(),
      page.getByRole('heading', { name: 'Add work area' })
    )

    await expect(page).toHaveURL(new RegExp('/workstations/new'))

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

    // clickWhenInteractive, not click: the button is HeroUI's and does nothing
    // until React Aria attaches onPress at hydration. See fixtures/auth.ts.
    await clickWhenInteractive(
      page.getByRole('button', { name: '+ Add window' }),
      starts.nth(before)
    )
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

  // F-MNT-20: OFF-01 lists the admin as implicitly Confirmed, marked
  // "<name> — You" (N27; "— Event admin" before) and without action buttons —
  // Peter's decision of 2026-06-24. This used to assert the opposite: the tenant admin had a
  // user_roles row but no `officials` row, so the roster omitted them. The
  // roster row now exists (ensure_admin_roster_row, migration
  // 20260911130436, applied to the seed admin by the backfill in
  // 20260911130546), which also clears the 404 the same admin used to get on
  // the official account screen (see access-control.spec.ts).
  test('lists the admin on the roster as You, without action buttons', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`${base}/officials`)

    // Not anchored with $: hasText matches the row's whole concatenated text,
    // which runs on past the name cell into the number and status cells
    // ('…— You+46 70 990 00 01ConfirmedAdmin'). An end anchor can therefore
    // never match a grid row, and this silently asserted on a shape the markup
    // never had.
    const adminRow = page.getByRole('row').filter({ hasText: /— You/ })
    await expect(adminRow).toHaveCount(1)

    // Implicitly Confirmed — never shown as Invited, since no SMS invite is
    // sent for the admin's own row.
    await expect(adminRow.getByText('Confirmed')).toBeVisible()

    // No action buttons on your own row: an admin cannot resend an invite to
    // themselves or remove themselves from the roster.
    //
    // Named rather than counted: since N17 every row's name cell is itself a
    // button, the disclosure that opens the shifts panel. A bare count would
    // now be 1 on a row that still carries no actions, so it would be
    // asserting the layout rather than the rule this test is about.
    //
    // Since N27 every other row's actions sit behind a ⋯ menu, so "no actions"
    // means no menu trigger on this row. You cannot change your own role.
    await expect(adminRow.getByRole('button', { name: /^Actions for / })).toHaveCount(0)
    await expect(adminRow.getByText('Admin', { exact: true })).toBeVisible()
  })

  // N17. This exercises the real HeroUI table, which is what the component
  // tests cannot: React Stately validates a row's cell count against the
  // column count as it builds the collection, and the first version of this
  // feature threw "Cell count must match column count" on the real table
  // while every stubbed component test passed.
  test('expanding an official shows their shifts and time off', async ({
    tenantAdminPage: page,
  }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (e) => pageErrors.push(e))

    await page.goto(`${base}/officials`)

    // Seeded with shifts, unlike 'Seed Official No Shifts' below.
    // exact: the row's ⋯ menu trigger is labelled "Actions for Seed Official
    // Confirmed" (N27), which a pattern on the name alone also matches.
    const toggle = page.getByRole('button', { name: 'Seed Official Confirmed', exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // The panel is the click's outcome, so clickWhenInteractive can retry
    // through the hydration race the same way the other HeroUI clicks here do.
    // Work area names come from the join, so their presence means the whole
    // read-fold-render path worked, not just that a panel opened.
    const panel = page.locator('[id^="official-detail-"]')
    await clickWhenInteractive(toggle, panel.getByText('Finish line').first())

    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // The toggle must name the panel it opens.
    expect(await toggle.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'))

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toHaveCount(0)

    // A row that renders but throws is still broken; the collection error
    // surfaced exactly this way.
    expect(pageErrors).toHaveLength(0)
  })

  test('an official with no shifts still gets a panel', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)

    const toggle = page.getByRole('button', { name: 'Seed Official No Shifts', exact: true })
    const panel = page.locator('[id^="official-detail-"]')

    await clickWhenInteractive(toggle, panel.getByText('Not scheduled yet.'))
  })

  test('add-official modal validates name and number', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)

    const modal = page.getByRole('dialog')
    await clickWhenInteractive(page.getByRole('button', { name: 'Add official' }).first(), modal)

    await expect(modal.getByText('Add official')).toBeVisible()

    // Send is gated on both fields; an invalid number keeps it disabled.
    const send = modal.getByRole('button', { name: 'Send invite' })
    await expect(send).toBeDisabled()

    await modal.getByLabel('Name').fill('E2E Test Official')

    const phone = modal.getByLabel('Mobile number')
    const invalidNumber = modal.getByText('Enter a valid mobile number for the selected country.')

    await phone.fill('123')
    await expect(send).toBeDisabled()

    // Still focused, so the number is only incomplete, not wrong: every valid
    // number is typed through invalid prefixes, and colouring the field red
    // mid-entry reads as a complaint about input the user has not finished.
    await expect(invalidNumber).toBeHidden()

    // Leaving it still invalid is what makes it an error worth showing.
    await phone.blur()
    await expect(invalidNumber).toBeVisible()
    await expect(send).toBeDisabled()

    // Closing without sending leaves the roster untouched — this suite must not
    // add officials to the shared seed tenant, which would skew EVT-01's counts.
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
  })

  test('removing an official asks for confirmation first', async ({ tenantAdminPage: page }) => {
    await page.goto(`${base}/officials`)

    // Remove sits in the row's ⋯ menu since N27. A confirmed non-admin row:
    // an admin's menu deliberately has no Remove.
    const menu = page.getByRole('menu')
    await clickWhenInteractive(
      page.getByRole('button', { name: 'Actions for Seed Official No Shifts' }),
      menu
    )

    const dialog = page.getByRole('dialog')
    await menu.getByRole('menuitem', { name: 'Remove' }).click()

    // N23 (7c): Remove takes them out of this event, and the tenant only
    // when it was their last.
    await expect(dialog.getByText(/taken off this event and its schedule/)).toBeVisible()

    // Cancel, not confirm: the removal is destructive and the roster is shared
    // with every other test in this suite.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
  })

  // N27, against the real HeroUI dropdown the component tests stub out.
  // Read-only on purpose: the roster and its roles are shared with every
  // other test in this suite, so nothing here grants or revokes a role.
  test('an invited official cannot be made admin until they confirm', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`${base}/officials`)

    const menu = page.getByRole('menu')
    await clickWhenInteractive(
      page.getByRole('button', { name: 'Actions for Seed Official Invited' }),
      menu
    )

    const makeAdmin = menu.getByRole('menuitem', { name: /Make admin/ })
    await expect(makeAdmin).toHaveAttribute('aria-disabled', 'true')
    await expect(makeAdmin).toContainText('Can be made admin once they have confirmed the invite')
    await expect(menu.getByRole('menuitem', { name: 'Re-send invite' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
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

    // The admin has a roster row since F-MNT-20 (ensure_admin_roster_row,
    // migration 20260911130436), so page.tsx renders the same AccountForm as
    // the official-facing screen rather than an admin-only variant — the
    // admin-only form this test used to assert on no longer exists.
    await expect(page.getByLabel('Name (editable)')).toBeEditable()
    await expect(page.getByText('Mobile number (read-only)')).toBeVisible()
  })

  // Admin-only, and deliberately shown even at zero: an admin's sidebar has no
  // My schedule entry, so this row is their only way in, and one with no shifts
  // still needs to be able to look. The count is rendered, not a condition —
  // which is why this lives here and not in official-screens.spec.ts.
  test('links to the schedule, and shows the count rather than gating on it', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`${base}/account`)

    await expect(page.getByRole('link', { name: /shift/ })).toBeVisible()
  })
})
