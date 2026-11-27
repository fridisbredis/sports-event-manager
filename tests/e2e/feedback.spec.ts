import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'
import type { Database } from '../../src/types/database'

// The seed tenant's display name, as the triage card shows it.
const SEED_TENANT_NAME = 'Seed Klubben'

// N71: Feedback, sent by a tenant admin (from the sidebar, with an image — so
// the upload goes through the real Storage API and its bucket policies) and by
// an official (from the account page). Each sees what they sent, with status
// New, in "Your feedback".

const base = `/${SEED_TENANT_SLUG}`

// A unique marker per run, so assertions find this run's rows and the cleanup
// below removes only them.
const RUN = `e2e-${Date.now()}`

// The smallest valid PNG: 1×1, transparent.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// The route allows 10 sends per user per 10 minutes, so rows from repeated
// local runs would eventually throttle the suite. Remove this run's rows and
// their images.
test.afterAll(async () => {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.from('feedback').select('id, image_path').like('title', `${RUN}%`)
  const paths = (data ?? []).map((r) => r.image_path).filter((p): p is string => !!p)
  if (paths.length) await admin.storage.from('feedback-images').remove(paths)
  if (data?.length) {
    await admin
      .from('feedback')
      .delete()
      .in(
        'id',
        data.map((r) => r.id)
      )
  }
})

async function fillAndSend(page: Page, type: string, title: string, withImage: boolean) {
  // Scoped to the type picker: the same words also label rows in "Your
  // feedback" once this user has sent something.
  await page.locator('fieldset').getByText(type, { exact: true }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Message').fill('Written by the e2e suite.')
  if (withImage) {
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByAltText('The attached image')).toBeVisible()
  }
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByText('Your feedback has been sent.')).toBeVisible()
}

// Serial: the system admin's test triages the rows the first two send, and
// the last checks the sender sees the status the system admin set.
test.describe.configure({ mode: 'serial' })

const ADMIN_BUG = `${RUN} admin bug`
const OFFICIAL_QUESTION = `${RUN} official question`

test('a tenant admin sends a bug report with an image from the sidebar', async ({
  tenantAdminPage: page,
}) => {
  await page.goto(`${base}/admin`)
  await page.getByRole('button', { name: 'Account and help' }).first().click()
  await page.getByRole('link', { name: 'Feedback' }).first().click()

  await expect(page).toHaveURL(/\/admin\/feedback\?from=/)
  await expect(page.getByRole('heading', { name: 'Feedback', level: 1 })).toBeVisible()

  const title = ADMIN_BUG
  await fillAndSend(page, 'Bug report', title, true)

  const row = page.getByRole('listitem').filter({ hasText: title })
  await expect(row).toBeVisible()
  await expect(row.getByText('New')).toBeVisible()
  await expect(row.getByText('Image attached')).toBeVisible()
})

test('an official sends a question from the account page', async ({
  officialConfirmedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/account`)
  await page.getByRole('link', { name: /Send feedback/ }).click()

  await expect(page).toHaveURL(new RegExp(`${base}/feedback$`))

  const title = OFFICIAL_QUESTION
  await fillAndSend(page, 'Question', title, false)

  const row = page.getByRole('listitem').filter({ hasText: title })
  await expect(row).toBeVisible()
  await expect(row.getByText('New')).toBeVisible()
})

test('a system admin sees both, sorted by type, and moves the bug to In progress', async ({
  systemAdminPage: page,
}) => {
  await page.goto('/admin')
  await page.getByRole('link', { name: 'Feedback' }).first().click()
  await expect(page).toHaveURL(/\/admin\/feedback$/)

  const bugs = page.getByRole('region', { name: 'Bug reports' })
  const questions = page.getByRole('region', { name: 'Questions' })

  const bug = bugs.getByRole('listitem').filter({ hasText: ADMIN_BUG })
  await expect(bug).toBeVisible()
  await expect(bug.getByText(SEED_TENANT_NAME, { exact: true })).toBeVisible()
  await expect(bug.getByText(/· Admin$/)).toBeVisible()
  // The image comes through a signed URL from the private bucket.
  await expect(bug.getByAltText('Image attached to the feedback')).toBeVisible()
  await expect
    .poll(() =>
      bug
        .getByAltText('Image attached to the feedback')
        .evaluate((img: HTMLImageElement) => img.naturalWidth)
    )
    .toBeGreaterThan(0)

  const question = questions.getByRole('listitem').filter({ hasText: OFFICIAL_QUESTION })
  await expect(question).toBeVisible()
  await expect(question.getByText(/· Official$/)).toBeVisible()

  await bug.getByLabel('Status').selectOption('in_progress')
  await expect(bug.getByText('In progress', { exact: true }).first()).toBeVisible()
  // Persisted, not just shown: a fresh load still says In progress.
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Bug reports' })
      .getByRole('listitem')
      .filter({ hasText: ADMIN_BUG })
      .getByLabel('Status')
  ).toHaveValue('in_progress')
})

test('the sender sees the status the system admin set', async ({ tenantAdminPage: page }) => {
  await page.goto(`${base}/admin/feedback`)
  const row = page.getByRole('listitem').filter({ hasText: ADMIN_BUG })
  await expect(row.getByText('In progress')).toBeVisible()
})
