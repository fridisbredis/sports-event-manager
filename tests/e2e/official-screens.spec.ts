import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'

// HOME-01, INFO-01, MYSCH-01, ANN-01 and the official half of ACCT-01.
// Role: official. These screens are mobile-first (DECISION 2026-06-24), so the
// whole file runs at a phone viewport.
test.use({ viewport: { width: 390, height: 844 } })

const base = `/${SEED_TENANT_SLUG}`

// 'Event info', 'My schedule' and 'Announcements' appear twice on HOME-01:
// once as a card and once in the bottom tab bar. Scope to the nav to be
// unambiguous about which one a test means.
const tabBar = (page: Page): Locator => page.locator('nav').last()

test.describe('HOME-01 official home', () => {
  test('greets the official and links to their screens', async ({
    officialConfirmedPage: page,
  }) => {
    await page.goto(`${base}/home`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi')

    for (const card of ['Event info', 'My schedule', 'Announcements', 'Personal account']) {
      await expect(page.getByRole('link', { name: new RegExp(card) }).first()).toBeVisible()
    }
  })

  const TABS: [string, string][] = [
    ['My schedule', '/schedule'],
    ['Event info', '/event-info'],
    ['Announcements', '/announcements'],
    ['Account', '/account'],
  ]

  for (const [tab, path] of TABS) {
    test(`bottom tab bar reaches ${tab}`, async ({ officialConfirmedPage: page }) => {
      await page.goto(`${base}/home`)
      await tabBar(page).getByRole('link', { name: tab, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    })
  }
})

test.describe('INFO-01 event info', () => {
  test('shows the event programme read-only', async ({ officialConfirmedPage: page }) => {
    await page.goto(`${base}/event-info`)

    await expect(page.getByRole('heading', { name: 'Event info' })).toBeVisible()
    await expect(page.getByText('Event programme by stage')).toBeVisible()

    // Read-only screen: nothing here submits anything.
    await expect(page.getByRole('button', { name: /Save|Publish/ })).toHaveCount(0)
  })

  test('officials see every stage of the event', async ({ officialConfirmedPage: page }) => {
    await page.goto(`${base}/event-info`)

    // INFO-01: officials-see-all-stages. page.tsx passes `stages` straight to
    // the list with no type filter, so every stage the event has must render.
    // The seed builds three (Day 1/2/3), so assert all three by name — the
    // previous `getByText(/^[123]$/).first()` matched a single stage-number
    // badge and passed even if only one card rendered.
    // Each stage name appears in three sections (dates, venue, programme), so
    // an unscoped getByText is a strict-mode violation rather than a signal.
    // Scope to the programme list and match the heading paragraph there.
    for (const name of ['Day 1', 'Day 2', 'Day 3']) {
      await expect(
        page.getByRole('paragraph').filter({ hasText: new RegExp(`^${name}$`) })
      ).toHaveCount(1)
    }

    // The "not just race stages" half of INFO-01 is NOT covered here: the seed
    // omits stage_type on all three stages, so they all default to 'race'
    // (scripts/seed-dev.ts) and there is no non-race stage to distinguish. To
    // cover it, the seed needs a stage_type: 'non_race' stage.
  })
})

test.describe('MYSCH-01 my schedule', () => {
  test('says who owns the schedule and offers both views', async ({
    officialConfirmedPage: page,
  }) => {
    await page.goto(`${base}/schedule`)

    const heading = page.getByRole('heading', { name: 'My schedule' })
    await expect(heading).toBeVisible()

    // "Set by organisers", not the old "Read-only": officials now write
    // checklist items and declare time off, so the page is no longer read-only
    // — what the badge claims is who decides the shifts on it.
    //
    // exact: true on purpose. The same words end several time-off strings
    // ("Time off set by organisers", and the availability screen's own badge),
    // so a substring match becomes a strict-mode violation the moment an
    // admin-set period lands on the selected day. The badge is the only place
    // the phrase stands alone.
    await expect(page.getByText('Set by organisers', { exact: true })).toBeVisible()

    // The view switch is a radiogroup, not two buttons — one either/or
    // choice, which is what lets a screen reader announce "1 of 2".
    const views = page.getByRole('radiogroup', { name: 'My schedule' })
    await expect(views.getByRole('radio', { name: 'Time' })).toBeVisible()
    await expect(views.getByRole('radio', { name: 'Work area' })).toBeVisible()
  })

  test('switching to the work area view is remembered', async ({ officialConfirmedPage: page }) => {
    await page.goto(`${base}/schedule`)

    const workArea = page.getByRole('radio', { name: 'Work area' })

    await workArea.click()
    // aria-checked, not the CSS class the earlier version asserted on: the
    // selected state is what a screen reader is told, so it is the thing worth
    // holding the app to. A restyle may change bg-primary; it must not change
    // this.
    await expect(workArea).toBeChecked()

    // Persisted in localStorage['official-schedule-view'], so it survives a
    // reload without a round-trip to the server.
    await page.reload()
    await expect(workArea).toBeChecked()
  })

  test('day selector navigates between the seeded days', async ({
    officialConfirmedPage: page,
  }) => {
    await page.goto(`${base}/schedule`)

    // The seed lays 4 shifts across 3 days, so the selector renders (it is
    // hidden below two days).
    const days = page.getByRole('navigation', { name: 'Choose a day' }).getByRole('link')
    await expect(days.first()).toBeVisible()

    // Unlike the view toggle, the day is URL state — and the selected day is
    // the one place in the app with a proper aria-current.
    await days.nth(1).click()
    await expect(page).toHaveURL(/\?day=\d{4}-\d{2}-\d{2}/)
    await expect(
      page.getByRole('navigation', { name: 'Choose a day' }).locator('[aria-current="page"]')
    ).toHaveCount(1)
  })

  test('an official with no shifts sees the empty state', async ({
    officialNoShiftsPage: page,
  }) => {
    await page.goto(`${base}/schedule`)

    await expect(page.getByText('No assignments yet')).toBeVisible()
    await expect(
      page.getByText("Your schedule will appear here once you've been assigned.")
    ).toBeVisible()

    // days.length === 0, so the day selector is not rendered at all.
    await expect(page.getByRole('navigation', { name: 'Choose a day' })).toHaveCount(0)
  })

  test('a single-day official gets no day selector', async ({ officialSingleDayPage: page }) => {
    await page.goto(`${base}/schedule`)
    // DaySelector returns null below two days.
    await expect(page.getByRole('navigation', { name: 'Choose a day' })).toHaveCount(0)
  })
})

test.describe('ANN-01 announcements', () => {
  test('reads the officials channel', async ({ officialConfirmedPage: page }) => {
    await page.goto(`${base}/announcements`)

    await expect(page.getByRole('heading', { name: 'Announcements' })).toBeVisible()

    // Read-only: officials can never post here (COMM-01 is the write side).
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
  })
})

test.describe('ACCT-01 official account', () => {
  test('name is editable, phone is not', async ({ officialConfirmedPage: page }) => {
    await page.goto(`${base}/account`)

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
    await expect(page.getByLabel('Name (editable)')).toBeEditable()

    // Read-only in v1: the number is rendered as a div, not a disabled input,
    // so there is no form control to find here.
    await expect(page.getByText('Mobile number (read-only)')).toBeVisible()
  })

  test('SMS notifications can be toggled off and back on', async ({
    officialConfirmedPage: page,
  }) => {
    await page.goto(`${base}/account`)

    const sms = page.getByRole('switch', { name: 'SMS updates' })
    const wasOn = await sms.isChecked()

    // The screen autosaves — the Save button this test used to click was
    // replaced by a polite aria-live region (SaveStatus in account-form.tsx).
    // Waiting for 'Saved' is what makes the reload below race-free.
    const saved = page.getByText('Saved', { exact: true })

    await sms.click()
    await expect(saved).toBeVisible()

    await page.reload()
    await expect(sms).toBeChecked({ checked: !wasOn })

    // Restore: this flag decides whether the SMS worker texts this official,
    // and the next run reuses the same seeded user.
    await sms.click()
    await expect(saved).toBeVisible()
  })

  // The schedule section is NOT here. Both halves of this pair used to live in
  // this file, asserting it appears when assignmentCount > 0 and not when it is
  // 0 — but account-form.tsx gates the section on `isDesktop` (the layout prop,
  // which only the admin screen passes) and says so: an official already has
  // My schedule in the bottom tab bar, so a second door to the same room is
  // not offered. The count never gated it.
  //
  // So the negative test passed for the wrong reason — the link is absent
  // because this user is an official, not because they have no shifts — and
  // the positive one could never pass here. Coverage moved to the admin
  // account screen, which is the one that renders it. See admin-screens.spec.ts.
  test('offers no second route to the schedule — the tab bar is the one door', async ({
    officialConfirmedPage: page,
  }) => {
    await page.goto(`${base}/account`)
    await expect(page.getByRole('link', { name: /assignment/ })).toHaveCount(0)
  })
})
