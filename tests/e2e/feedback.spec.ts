import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'
import type { Database } from '../../src/types/database'

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
  await page.getByText(type, { exact: true }).click()
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

test('a tenant admin sends a bug report with an image from the sidebar', async ({
  tenantAdminPage: page,
}) => {
  await page.goto(`${base}/admin`)
  await page.getByRole('button', { name: 'Account and help' }).first().click()
  await page.getByRole('link', { name: 'Feedback' }).first().click()

  await expect(page).toHaveURL(/\/admin\/feedback\?from=/)
  await expect(page.getByRole('heading', { name: 'Feedback', level: 1 })).toBeVisible()

  const title = `${RUN} admin bug`
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

  const title = `${RUN} official question`
  await fillAndSend(page, 'Question', title, false)

  const row = page.getByRole('listitem').filter({ hasText: title })
  await expect(row).toBeVisible()
  await expect(row.getByText('New')).toBeVisible()
})
