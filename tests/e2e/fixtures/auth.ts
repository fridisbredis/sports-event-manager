import { test as base, expect, type Page, type Browser } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { USERS, OTP_CODE, type RoleKey } from './users'

const STATE_DIR = path.resolve(__dirname, '../.auth')

// Drives the real two-step sign-in form at /login: phone -> OTP. This is the
// only place the suite authenticates; everything else replays the cookies it
// produces. Kept as a real UI flow rather than an injected session so AUTH-01
// is genuinely covered and so a regression in the form breaks the whole suite
// loudly instead of going unnoticed.
export async function signInThroughUi(page: Page, phone: string) {
  await page.goto('/login')

  // The form posts normalizePhoneToE164(), which strips the leading '+'. Typing
  // the full E.164 number means the country Select never has to be touched:
  // parsePhoneNumberFromString accepts E.164 whatever country is selected.
  await page.getByLabel('Phone number').fill(phone)

  const sendButton = page.getByRole('button', { name: 'Send code' })
  // Enabled only once isValidPhoneForCountry() passes, so waiting on it doubles
  // as an assertion that the number was accepted as valid.
  await expect(sendButton).toBeEnabled()

  // GoTrue throttles OTP sends per number ([auth.sms] max_frequency), and the
  // app adds its own 5/hour limit. Both surface as the phone step simply
  // staying put with a toast, which is indistinguishable from a broken
  // selector at the point of failure — so retry the send rather than letting
  // the suite fail on throttling that has nothing to do with the test.
  const codeField = page.getByLabel('6-digit code')
  for (let attempt = 1; ; attempt++) {
    await sendButton.click()

    // Step 2 renders in place — same route, no navigation.
    if (await codeField.isVisible({ timeout: 5_000 }).catch(() => false)) break

    if (attempt === 4) {
      const toast = await page
        .getByRole('alert')
        .first()
        .textContent()
        .catch(() => null)
      throw new Error(
        `Could not get past the phone step for ${phone} after ${attempt} attempts. ` +
          `Last message on screen: ${toast?.trim() || '(none)'}.\n` +
          'If this says the number was not recognized, the dev server is talking to the wrong ' +
          'Supabase project; if it mentions attempts, the login rate limit has not reset.'
      )
    }
    await page.waitForTimeout(2_000)
  }

  await codeField.fill(OTP_CODE)

  await page.getByRole('button', { name: 'Verify' }).click()

  // verifyOtp() does router.push('/') and '/' resolves the role-based redirect,
  // so landing anywhere other than /login means the session took hold.
  await expect(page).not.toHaveURL(/\/login/)
}

// Signs in once per role per run and caches the cookies on disk. GoTrue's local
// rate limits (sms_sent 30/h, token_verifications 30/5min) are low enough that
// one sign-in per test would exhaust them partway through a full-suite run.
async function storageStateFor(role: RoleKey, browser: Browser) {
  const statePath = path.join(STATE_DIR, `${role}.json`)
  if (fs.existsSync(statePath)) return statePath

  fs.mkdirSync(STATE_DIR, { recursive: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await signInThroughUi(page, USERS[role].phone)
    await context.storageState({ path: statePath })
  } finally {
    await context.close()
  }
  return statePath
}

// One fixture per role. A spec declares the role it needs and gets a page
// already signed in as that user:
//
//   test('...', async ({ tenantAdminPage }) => { ... })
//
// Naming the role in the fixture is deliberate — it makes "which role is this
// path tested as" readable from the test body alone.
type RoleFixtures = {
  [K in RoleKey as `${K}Page`]: Page
}

function roleFixture(role: RoleKey) {
  return async ({ browser }: { browser: Browser }, use: (page: Page) => Promise<void>) => {
    const context = await browser.newContext({
      storageState: await storageStateFor(role, browser),
    })
    const page = await context.newPage()
    await use(page)
    await context.close()
  }
}

export const test = base.extend<RoleFixtures>({
  systemAdminPage: roleFixture('systemAdmin'),
  tenantAdminPage: roleFixture('tenantAdmin'),
  officialConfirmedPage: roleFixture('officialConfirmed'),
  officialSingleDayPage: roleFixture('officialSingleDay'),
  officialNoShiftsPage: roleFixture('officialNoShifts'),
})

export { expect }
