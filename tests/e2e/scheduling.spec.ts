import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

// SCHED-01 Scheduling grid. Role: tenant admin — the only role that reaches it
// (access-control.spec.ts covers who is turned away; this is about behaviour).
//
// The screen's four quirks, and why each needs a browser rather than a unit test:
//
//   1. No Save button. Every edit autosaves through use-scheduling-autosave, so
//      a test has to wait for the write to land instead of clicking Save. The
//      hook is unit-tested against a mock; what is untested is the hook wired to
//      a real grid that re-renders after router.refresh() — the shape of the
//      stale-state and frozen-cell bugs that reached prod.
//   2. Stage and day live in the URL; the view toggle is local useState. A
//      shared link must restore the first two and not the third.
//   3. Over capacity warns, outside the operating window is hard-blocked.
//   4. by-work-area only accepts edits on an expanded row.
//
// F7 applies: the suite shares one mutable seed tenant at workers: 1, so every
// test here puts back what it changed.

// Wider than Playwright's 1280x720 default, which the other admin specs are
// happy with. SCHED-01 draws one column per hour — eleven assignable ones at the
// seed's 60-minute granularity — plus a sticky name column, so the right-hand
// slots sit off-screen at the default width. That matters beyond having to
// scroll: the work-area picker and the cell action popup are positioned `fixed`
// from the clicked cell's getBoundingClientRect(), so for a cell near the right
// edge the popup renders outside the viewport and Playwright cannot click it —
// which is a test-harness limit, not a bug in the screen, since a real admin
// scrolls the grid and the popup follows. 1680 keeps every slot reachable.
test.use({ viewport: { width: 1680, height: 900 } })

const SCHEDULING = `/${SEED_TENANT_SLUG}/admin/scheduling`

// The seed builds three stages, one per day, 07:00–18:00 UTC at 60-minute
// granularity, each with 'Finish line' (ceiling 4) and 'Water station'
// (ceiling 2). Day 1 is the default stage and where the seeded assignments are;
// Day 2 is what the URL tests switch to.
const STAGE_DAY_1 = 'Day 1'
const STAGE_DAY_2 = 'Day 2'
const FINISH_LINE = 'Finish line'
const WATER_STATION = 'Water station'

// The seed's stage dates are relative — SEED_DAYS in scripts/seed-dev.ts maps
// offsets [0, 1, 2] onto the *UTC* date of the run and names the stages
// 'Day 1'..'Day 3' in that order. So the dates move, and no literal written
// here stays true: that is how this spec came to fail the morning after it was
// written. Deriving them from today's date is not enough either — the seed only
// reseeds when the tenant is absent (F7), so a stack seeded last week still
// serves last week's dates. The specs below therefore read what the screen
// pins and assert the relationship between the days, never the days themselves.

// Autosave has no completion signal in the DOM — no Save button, no toast on
// success. What it does do is router.refresh() once the server action returns,
// so the cell stops being a Skeleton and renders its work-area name. Waiting on
// the cell's own text is therefore the honest signal; a fixed timeout would
// either flake or slow every test down.
async function expectCellAssigned(page: Page, official: string, slotIndex: number, ws: string) {
  await expect(personCell(page, official, slotIndex)).toContainText(ws, { timeout: 15_000 })
}

// Cells are <td>s in the official's row. Indexing by slot rather than by
// accessible name because an empty cell has no name — it is a bare button,
// which is exactly the thing being clicked to create an assignment.
//
// Indexed by column position, not by "nth cell containing a button": while a
// save is in flight the cell renders a <Skeleton> with no button at all, so a
// :has(button) index silently shifts every later slot by one and the next click
// lands on the wrong time. That shift is what made these specs flake, and it
// left real assignments behind on cells no test then cleaned up.
//
// SLOT_COLUMN_OFFSET is 2: td[0] is the sticky name column and td[1] is the
// 06:00 column, which the seed's 07:00–18:00 operating window leaves outside
// (rendered as a striped <div>, the hard block the capacity spec asserts on).
// So slot 0 is 07:00 and the assignable columns run 0..10 — 07:00 to 17:00.
function personRow(page: Page, official: string) {
  return page.getByRole('row').filter({ hasText: official })
}

const SLOT_COLUMN_OFFSET = 2

function personCell(page: Page, official: string, slotIndex: number) {
  return personRow(page, official)
    .locator('td')
    .nth(slotIndex + SLOT_COLUMN_OFFSET)
}

// The picker renders as a floating panel marked data-person-drag-picker. It
// replaced the old click-to-open data-picker-cell panel when the row became
// drag-to-paint: an empty cell now carries only pointer handlers, and a
// pointerup anywhere opens the picker for the painted run — so a plain click
// still reaches it, as a one-slot paint.
//
// Scoping to the panel matters: its options are named "<work area>
// <n>/<ceiling>", exactly like the filled cells already in the grid, so an
// unscoped getByRole would be ambiguous the moment any cell is filled. The
// colour swatch is aria-hidden, so it does not enter the accessible name.
function pickerOption(page: Page, workArea: string) {
  return page
    .locator('[data-person-drag-picker]')
    .getByRole('button', { name: new RegExp(`^${workArea}`) })
}

// Same story for the cell action popup (data-cell-action) and its Remove button.
function cellActionRemove(page: Page) {
  return page.locator('[data-cell-action]').getByRole('button', { name: 'Remove' })
}

async function assignCell(page: Page, official: string, slotIndex: number, workArea: string) {
  await personCell(page, official, slotIndex).getByRole('button').click()
  await pickerOption(page, workArea).click()
  await expectCellAssigned(page, official, slotIndex, workArea)
}

// Safe to call on a cell that was never filled, so it can be used from a
// finally-block without having to know how far the test got.
//
// Retries because the first click can land on nothing: while a save or a reload
// is still settling the cell renders a <Skeleton> with no button, and
// handleCellAction() closes the popup before awaiting the delete — so a popup
// that opened and vanished is not evidence the row is gone. The cell's own text
// is the only signal tied to the write, so that is what the loop waits on.
async function clearCell(page: Page, official: string, slotIndex: number, workArea: string) {
  const cell = personCell(page, official, slotIndex)

  // Up to 6 passes, one removal each. An over-capacity slot holds several
  // assignments in the same cell and the popup lists a Remove per row, so one
  // click is not enough — and the cell only stops naming the work area once the
  // last of them is gone.
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (!((await cell.textContent()) ?? '').includes(workArea)) return

    const button = cell.getByRole('button')
    if ((await button.count()) === 0) {
      // Mid-save: the cell is a <Skeleton> with nothing to click. Wait it out.
      await page.waitForTimeout(1_000)
      continue
    }

    await button.first().click()
    const remove = cellActionRemove(page)
    if (
      !(await remove
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false))
    ) {
      // The popup did not open (a click that landed as the cell re-rendered).
      await page.keyboard.press('Escape')
      continue
    }
    await remove.first().click()

    // handleCellAction() closes the popup before awaiting the delete, so the
    // popup going away proves nothing. Give the write a beat to land, then let
    // the loop re-read the cell — the only signal tied to the database.
    await page.waitForTimeout(1_500)
  }

  // Out of attempts: fail loudly rather than leaving rows behind for the next
  // spec to trip over. A leaked assignment is exactly the shared-fixture damage
  // F7 warns about, and global-setup's cleanup only runs between whole runs.
  await expect(cell).not.toContainText(workArea, { timeout: 15_000 })
}

async function selectStage(page: Page, stageName: string) {
  // The dropdown trigger is labelled with whichever stage is current, so it is
  // addressed by that rather than by a fixed name.
  await page.getByRole('button', { name: /^Day \d$/ }).click()
  // HeroUI's Dropdown renders its rows as menuitemradio (selectionMode
  // "single"), not as options — the listbox role belongs to its Select.
  await page.getByRole('menuitemradio', { name: stageName }).click()
  await expect(page.getByRole('button', { name: stageName })).toBeVisible()

  // The trigger relabels from local state the moment the row is clicked, but
  // handleSelectStage then calls changeDay(), whose router.push() writes the
  // params a beat later. Waiting on the label alone therefore returns before
  // the URL is updated, and a caller reading searchParams gets the old one —
  // which is what made the two tests below flake.
  await expect(page).toHaveURL(/[?&]stage=[0-9a-f-]{36}&day=\d{4}-\d{2}-\d{2}/)
}

test.describe('SCHED-01 grid', () => {
  test('renders the toolbar, both views and the legend', async ({ tenantAdminPage: page }) => {
    await page.goto(SCHEDULING)

    await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible()

    // Stage dropdown and the day stepper either side of the day label.
    await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()

    // The view toggle is a real tablist — role="tab" + aria-selected, not the
    // CSS-only marker the e2e findings doc (F6) recorded. Asserting on the ARIA
    // state rather than on bg-primary keeps this from breaking on a restyle.
    const tablist = page.getByRole('tablist', { name: 'Schedule view' })
    await expect(tablist).toBeVisible()
    await expect(tablist.getByRole('tab', { name: 'By person' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(tablist.getByRole('tab', { name: 'By work area' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  test('lists only confirmed officials, and includes the admin', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)

    // The schedulable pool is officials filtered to invite_status='confirmed'.
    await expect(page.getByRole('cell', { name: 'Seed Official Confirmed' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Seed Official No Shifts' })).toBeVisible()

    // Invited and removed officials are not schedulable and must not appear.
    await expect(page.getByRole('cell', { name: 'Seed Official Invited' })).toHaveCount(0)
    await expect(page.getByRole('cell', { name: 'Seed Official Removed' })).toHaveCount(0)

    // F-MNT-20: the tenant admin holds an officials row and so is schedulable.
    // This is the assertion that would have caught the original defect, where
    // the admin was absent from the grid entirely.
    await expect(page.getByRole('cell', { name: '46709900001' })).toBeVisible()
  })
})

test.describe('SCHED-01 stage and day in the URL', () => {
  // Each seeded stage spans a single day (07:00–18:00 on its own stage_date),
  // so the day stepper is disabled at both ends and changing day means changing
  // stage. That is a property of the fixture, not of the screen — the stepper
  // exists for a stage that spans several days, which the seed has none of.
  test('pins stage and day into the URL when the stage changes', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)
    await expect(page.getByRole('button', { name: 'Previous day' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()

    // Read the day each stage pins rather than asserting a date. The seed
    // builds its stages relative to the day it ran and only reseeds when the
    // tenant is absent (F7), so the actual dates depend on when this stack was
    // seeded — a literal here passes until midnight UTC and then fails for a
    // reason that has nothing to do with the screen. What the screen promises
    // is the relationship: Day N pins stage N's own date, and the seeded stages
    // are consecutive.
    await selectStage(page, STAGE_DAY_1)
    const dayOne = new URL(page.url()).searchParams.get('day') ?? ''
    expect(dayOne).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Wait for the day to *change*, not merely for the URL to look right.
    // selectStage()'s shape check is already satisfied by the push above, so it
    // would return before this second push lands and leave the read below on
    // Day 1's date (F13, one step further on).
    await page.getByRole('button', { name: /^Day \d$/ }).click()
    await page.getByRole('menuitemradio', { name: STAGE_DAY_2 }).click()
    await expect(page.getByRole('button', { name: STAGE_DAY_2 })).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`stage=[0-9a-f-]{36}&day=(?!${dayOne})\\d{4}-\\d{2}-\\d{2}`)
    )

    const dayTwo = new URL(page.url()).searchParams.get('day') ?? ''

    const oneDayLater = new Date(`${dayOne}T00:00:00Z`)
    oneDayLater.setUTCDate(oneDayLater.getUTCDate() + 1)
    expect(dayTwo).toBe(oneDayLater.toISOString().slice(0, 10))
  })

  test('restores stage and day from a shared link, but not the view', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)
    await selectStage(page, STAGE_DAY_2)
    await page.getByRole('tab', { name: 'By work area' }).click()
    await expect(page.getByRole('tab', { name: 'By work area' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    // Opening the link fresh, the way a colleague receiving it would. reload()
    // rather than goto(url): the browser is already at that exact URL, so a
    // goto to it is a no-op and would leave the client state standing — which
    // is precisely what this test exists to clear.
    const shared = page.url()
    await page.reload()
    expect(page.url()).toBe(shared)

    // Stage and day survive — they are in the URL the server reads.
    await expect(page.getByRole('button', { name: STAGE_DAY_2 })).toBeVisible()
    // The view does not: it is local useState, so a reload drops back to the
    // by-person default. Worth pinning deliberately — someone sharing a link to
    // a by-work-area view does not get that view, and this records it as the
    // current contract rather than an accident.
    await expect(page.getByRole('tab', { name: 'By person' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('falls back when the day is outside the selected stage', async ({
    tenantAdminPage: page,
  }) => {
    // The grid only writes ?stage= when the stage is changed, never on first
    // load, so the id has to come from changing stage rather than from reading
    // the initial URL.
    await page.goto(SCHEDULING)
    await selectStage(page, STAGE_DAY_2)
    const stageId = new URL(page.url()).searchParams.get('stage') ?? ''
    expect(stageId).not.toBe('')

    // A stale link — the stage's dates were edited after the link was made.
    // page.tsx validates ?day= against the stage's allocable days and falls
    // back rather than letting dayIndex resolve to -1 downstream.
    await page.goto(`${SCHEDULING}?stage=${stageId}&day=2099-01-01`)

    await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible()
    // Fell back to the stage's own day rather than rendering an empty grid.
    await expect(page.getByRole('columnheader', { name: 'Official' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Seed Official Confirmed' })).toBeVisible()
  })

  test('ignores a stage that does not belong to this event', async ({ tenantAdminPage: page }) => {
    // Same defensive validation on ?stage=: a tampered or stale id must not put
    // the grid in a broken state, it falls back to getCurrentStage()/first.
    await page.goto(`${SCHEDULING}?stage=00000000-0000-0000-0000-000000000000`)

    await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Seed Official Confirmed' })).toBeVisible()
  })
})

test.describe('SCHED-01 assigning without a Save button', () => {
  // 'Seed Official No Shifts' is seeded with nothing, so these tests own every
  // cell in that row and cannot collide with the seeded assignments (F7).
  const OFFICIAL = 'Seed Official No Shifts'

  test('assigns an official to a work area and persists it across a reload', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)

    // No Save button and no success toast — the write is confirmed by the cell
    // itself rendering the work area it was assigned to.
    await assignCell(page, OFFICIAL, 0, FINISH_LINE)

    // The real assertion: it reached the database, not just React state. This
    // is the half a unit test against a mocked client cannot reach, and the
    // shape of the stale-state bug that reached prod.
    await page.reload()
    await expect(personCell(page, OFFICIAL, 0)).toContainText(FINISH_LINE)

    await clearCell(page, OFFICIAL, 0, FINISH_LINE)
    await page.reload()
    await expect(personCell(page, OFFICIAL, 0)).not.toContainText(FINISH_LINE)
  })

  test('removes an assignment through the cell action popup', async ({ tenantAdminPage: page }) => {
    await page.goto(SCHEDULING)
    await assignCell(page, OFFICIAL, 1, WATER_STATION)

    // Clicking a filled cell opens the action popup rather than reassigning —
    // that distinction is what this test is about, so the popup is opened and
    // asserted on here rather than left to clearCell().
    await personCell(page, OFFICIAL, 1).getByRole('button').click()
    const popup = page.locator('[data-cell-action]')
    await expect(popup).toBeVisible()
    await expect(popup.getByRole('button', { name: 'Remove' })).toBeVisible()
    // 'Mark as assigned' is deliberately absent: addAssignment() writes
    // status 'assigned' already, and the popup renders that action only for a
    // row that is not yet in that state.
    await expect(popup.getByRole('button', { name: 'Mark as assigned' })).toHaveCount(0)

    // handleCellAction() closes the popup before awaiting the save, so the
    // popup disappearing says nothing about whether the delete landed. Close it
    // and let clearCell() drive the removal, which waits on the cell itself —
    // the only signal tied to the write rather than to the UI reacting.
    await page.keyboard.press('Escape')
    await clearCell(page, OFFICIAL, 1, WATER_STATION)

    await page.reload()
    await expect(personCell(page, OFFICIAL, 1)).not.toContainText(WATER_STATION)
  })

  test('shows assigned-over-ceiling on the cell and in the picker', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)

    await personCell(page, OFFICIAL, 2).getByRole('button').click()
    // The picker shows assigned/ceiling per work area before you commit.
    await expect(pickerOption(page, WATER_STATION)).toContainText('/2')
    await pickerOption(page, WATER_STATION).click()
    await expectCellAssigned(page, OFFICIAL, 2, WATER_STATION)

    // Water station's ceiling is 2, so a lone assignment reads 1/2.
    await expect(personCell(page, OFFICIAL, 2)).toContainText('1/2')

    await clearCell(page, OFFICIAL, 2, WATER_STATION)
  })
})

test.describe('SCHED-01 over capacity warns rather than blocks', () => {
  test('fills a work area past its ceiling and warns without refusing the write', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(SCHEDULING)

    // Water station's ceiling is 2. Three officials in one slot puts it over.
    //
    // Slot 8 (15:00) rather than something earlier: the seed fills 08:00, 10:00
    // and 12:00 on day 1 — slots 1, 3 and 5 counting the assignable columns from
    // 07:00 — and a cell that already holds an assignment opens the action popup
    // instead of the work-area picker, so assignCell() would hang there. Picking
    // a slot this spec owns outright keeps it independent of the fixture.
    const officials = [
      'Seed Official No Shifts',
      'Seed Official One Day',
      'Seed Official Confirmed',
    ]
    const SLOT = 8

    try {
      for (const official of officials) {
        await assignCell(page, official, SLOT, WATER_STATION)
      }

      // Soft, not hard: the third assignment was accepted and saved. The banner
      // reports it; nothing was refused. This is the half that distinguishes
      // over-capacity from the out-of-window case below.
      await expect(
        page.getByText(/work area is over capacity|work areas are over capacity/)
      ).toBeVisible()
      await expect(personCell(page, officials[2], SLOT)).toContainText('3/2')

      await page.reload()
      await expect(personCell(page, officials[2], SLOT)).toContainText(WATER_STATION)
    } finally {
      // Restore even if an assertion above failed: the seed tenant is shared and
      // mutable (F7), so a half-finished run would otherwise leave three extra
      // assignments behind for every later spec to trip over.
      await page.reload()
      for (const official of officials) {
        await clearCell(page, official, SLOT, WATER_STATION)
      }
    }
  })

  test('hard-blocks a slot outside the operating window', async ({ tenantAdminPage: page }) => {
    await page.goto(SCHEDULING)

    // The stage runs 07:00–18:00 and so does every work area's operating
    // window, so the 06:00 and 18:00 columns the grid draws at either end fall
    // outside it. Those cells render as a striped <div> with no button at all —
    // not a disabled button — so there is nothing to click. That is the hard
    // block, as against the warning above.
    const row = personRow(page, 'Seed Official No Shifts')
    const firstCell = row.locator('td').nth(1)

    await expect(firstCell).toBeVisible()
    await expect(firstCell.getByRole('button')).toHaveCount(0)

    // And the picker only ever offers work areas whose window covers the slot,
    // so an assignable cell cannot be pointed at a closed work area either.
    await personCell(page, 'Seed Official No Shifts', 0).getByRole('button').click()
    await expect(page.locator('[data-person-drag-picker]')).toBeVisible()
    await expect(pickerOption(page, FINISH_LINE)).toBeVisible()
    await page.keyboard.press('Escape')
  })
})

test.describe('SCHED-01 by work area', () => {
  test('only offers slot edits once the row is expanded', async ({ tenantAdminPage: page }) => {
    await page.goto(SCHEDULING)
    await page.getByRole('tab', { name: 'By work area' }).click()

    const row = page.getByRole('row').filter({ hasText: FINISH_LINE }).first()
    await expect(row).toBeVisible()

    // Collapsed: the summary row shows counts, but the numbered slot rows that
    // accept edits are not rendered at all — isExpanded gates them entirely.
    await expect(row.getByRole('button', { name: 'Expand' })).toBeVisible()
    // The numbered rows are labelled '#1', '#2' … — 'Slot #' is the modal's
    // wording, not the row's.
    await expect(page.getByRole('cell', { name: '#1', exact: true })).toHaveCount(0)

    await row.getByRole('button', { name: 'Expand' }).click()
    await expect(row.getByRole('button', { name: 'Collapse' })).toBeVisible()
    await expect(page.getByRole('cell', { name: '#1', exact: true }).first()).toBeVisible()

    // Collapsing takes them away again.
    await row.getByRole('button', { name: 'Collapse' }).click()
    await expect(page.getByRole('cell', { name: '#1', exact: true })).toHaveCount(0)
  })

  test('opens the slot modal from an expanded row', async ({ tenantAdminPage: page }) => {
    await page.goto(SCHEDULING)
    await page.getByRole('tab', { name: 'By work area' }).click()

    const row = page.getByRole('row').filter({ hasText: WATER_STATION }).first()
    await row.getByRole('button', { name: 'Expand' }).click()

    const slotRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: '#1', exact: true }) })
      .first()
    await expect(slotRow).toBeVisible()

    // The expanded numbered slot cells are what open the modal.
    await slotRow.locator('td').nth(SLOT_COLUMN_OFFSET).getByRole('button').first().click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText(WATER_STATION)

    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
  })
})
