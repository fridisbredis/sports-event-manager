import { test as base, expect, type Locator, type Page, type Browser } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { USERS, OTP_CODE, type RoleKey } from './users'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/types/database'
import { loginPhoneRateLimitKey } from '../../../src/lib/rate-limit'

const STATE_DIR = path.resolve(__dirname, '../.auth')

// Drives the real two-step sign-in form at /login: phone -> OTP. This is the
// only place the suite authenticates; everything else replays the cookies it
// produces. Kept as a real UI flow rather than an injected session so AUTH-01
// is genuinely covered and so a regression in the form breaks the whole suite
// loudly instead of going unnoticed.
// Drops this number's login counters right before signing in as it.
//
// The app allows 5 sends per phone per hour (LOGIN_SEND_LIMIT), which is
// generous for a person and tight for a suite: the busiest numbers sign in
// twice per run — once to fill the storageState cache, once in auth.spec's
// role loop — and the retry below spends another send per attempt, so a
// throttled sign-in burns the rest of the budget trying to recover from being
// throttled. global-setup clears these once, but they then accumulate for the
// rest of the run.
//
// Scoped to the one number about to be used, so the limiter stays in force for
// every other phone and every other path. It is covered directly by
// rate-limit.test.ts and by the route tests; what is pointless here is the
// suite throttling itself.
async function clearLoginBudget(phone: string) {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  // Loud, not a silent skip: without this the number keeps its accumulated
  // sends and the run fails later as "Too many attempts", several tests away
  // from the cause. globalSetup sets both.
  if (!url || !key) {
    throw new Error(
      'E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY are unset — globalSetup did not run.'
    )
  }

  const admin = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const keys = [loginPhoneRateLimitKey('send', phone), loginPhoneRateLimitKey('verify', phone)]
  const { error } = await admin.from('rate_limit_hits').delete().in('key', keys)
  if (error) throw error
}

export async function signInThroughUi(page: Page, phone: string) {
  await clearLoginBudget(phone)
  await page.goto('/login')

  // The form posts normalizePhoneToE164(), which strips the leading '+'. Typing
  // the full E.164 number means the country Select never has to be touched:
  // parsePhoneNumberFromString accepts E.164 whatever country is selected.
  await page.getByLabel('Phone number').fill(phone)

  // exact: the OTP step's button is "Resend code (30s)", which contains "Send
  // code" case-insensitively and so matches a non-exact name filter. Without
  // this, a stray retry targets the resend countdown instead of the phone
  // step's own button.
  const sendButton = page.getByRole('button', { name: 'Send code', exact: true })
  // Enabled only once isValidPhoneForCountry() passes, so waiting on it doubles
  // as an assertion that the number was accepted as valid.
  await expect(sendButton).toBeEnabled()

  // GoTrue throttles OTP sends per number ([auth.sms] max_frequency), and the
  // app adds its own 5/hour limit. Both surface as the phone step simply
  // staying put with a toast, which is indistinguishable from a broken
  // selector at the point of failure — so retry the send rather than letting
  // the suite fail on throttling that has nothing to do with the test.
  //
  // clearLoginBudget() above only clears the *app's* counters; GoTrue's
  // max_frequency is its own ceiling and cannot be cleared from the database,
  // so this loop is what absorbs it. It matters more than it looks: against a
  // production build the suite is fast enough to put two sends for the same
  // number inside the same second, and GoTrue answers
  // `over_sms_send_rate_limit` ("you can only request this after 0 seconds").
  // Against `next dev` the per-route compile happened to space the sends out
  // far enough that this was rarely hit.
  const codeField = page.getByLabel('6-digit code')
  for (let attempt = 1; ; attempt++) {
    // Only ever click while the phone step is actually still on screen.
    //
    // This guard is the whole point of the loop's shape. On success the form
    // swaps step 2 in place and the same button becomes the OTP step's
    // "Resend code (30s)" countdown — a *different* control that happens to
    // match a loose selector. A retry that fired after a send had already
    // succeeded therefore clicked resend, and Playwright waited out the full
    // 30s cooldown for it to become enabled. That cost ~31s per sign-in and
    // was the single largest line item in the suite: 13 tests at ~31s each,
    // 400s of a 470s run, on sign-ins that had already worked on click one.
    if (await codeField.isVisible({ timeout: 100 }).catch(() => false)) break
    await sendButton.click()

    // Step 2 renders in place — same route, no navigation. It is a local state
    // flip once /api/auth/send-otp answers, so it lands in well under a second
    // on a warm server; 5s is slack for a cold one, not an expected wait.
    if (await codeField.isVisible({ timeout: 5_000 }).catch(() => false)) break

    if (attempt === 6) {
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
    // Just past GoTrue's 1s max_frequency. Six attempts at this spacing still
    // cover a number that is briefly throttled, while costing a fraction of
    // what four attempts at 2s did.
    await page.waitForTimeout(1_200)
  }

  // fill, then assert the value stuck. The OTP field is a controlled HeroUI
  // input and Verify is gated on `otp.length === 6`, so a fill that lands
  // before React has hydrated writes to the DOM, never reaches state, and
  // leaves Verify disabled for the rest of the test — which surfaces as a
  // 60s timeout on a button that is visibly right there. Same hydration race
  // the admin screens hit, seen on an input instead of a button.
  const verify = page.getByRole('button', { name: 'Verify' })
  await expect(async () => {
    await codeField.fill(OTP_CODE)
    await expect(codeField).toHaveValue(OTP_CODE, { timeout: 1_000 })
    await expect(verify).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await verify.click()

  // verifyOtp() does router.push('/') and '/' resolves the role-based redirect,
  // so landing anywhere other than /login means the session took hold.
  await expect(page).not.toHaveURL(/\/login/)
}

// Signs in once per role per run and caches the cookies on disk. GoTrue's local
// rate limits (sms_sent 30/h, token_verifications 30/5min) are low enough that
// one sign-in per test would exhaust them partway through a full-suite run.
// A cached session is only as good as the access token inside it. GoTrue issues
// those with a one-hour life, but writes them into a cookie whose own expiry is
// years out — so Playwright keeps sending a token the server stopped accepting,
// the proxy treats the request as signed out and redirects to /login, and being
// "logged in" it bounces back, which surfaces as ERR_TOO_MANY_REDIRECTS rather
// than as an auth failure. Re-signing in on age is what keeps a cache left over
// from an earlier day from failing the next run in a way that looks like a
// routing bug.
const STATE_MAX_AGE_MS = 30 * 60 * 1000

function isFresh(statePath: string): boolean {
  try {
    return Date.now() - fs.statSync(statePath).mtimeMs < STATE_MAX_AGE_MS
  } catch {
    return false
  }
}

async function storageStateFor(role: RoleKey, browser: Browser) {
  const statePath = path.join(STATE_DIR, `${role}.json`)
  if (isFresh(statePath)) return statePath

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

// Clicks a control that only works once React has hydrated, retrying until the
// click actually takes effect.
//
// The admin screens are server components wrapping 'use client' forms, and
// their buttons are HeroUI's, whose onPress comes from React Aria. Before
// hydration the markup is in the DOM and passes every actionability check
// Playwright makes — visible, enabled, stable — so a click lands on a
// live-looking dead button and silently does nothing. Waiting on a heading
// does not help: headings are in the SSR payload too.
//
// Rather than probe for hydration (Next exposes no public signal, and React
// Aria's data-* attributes are internals), assert the click's own effect and
// retry the pair. Once the handler is attached the first attempt succeeds, so
// this costs nothing on an already-hydrated page.
//
// `expectVisible` is the outcome the click should produce — usually the dialog
// it opens or the heading of the page it navigates to. It must be cheap and
// side-effect free: it is polled on every attempt.
//
// Two things the retry has to respect, both learned from CI:
//
//   - A click that navigates removes the button. Re-clicking then fails with
//     "element(s) not found" for the rest of the timeout, which is how the
//     `+ Add work area` case failed on the first run of this helper. So only
//     re-click while the target is still attached, and keep waiting on the
//     outcome when it is gone — the click did land.
//   - The outcome can be slow the first time. A route the dev server has not
//     compiled takes seconds to render, so the per-attempt wait has to be
//     generous enough not to give up on a click that worked.
export async function clickWhenInteractive(
  target: Locator,
  expectVisible: Locator,
  timeout = 30_000
) {
  const deadline = Date.now() + timeout

  await target.click()

  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      // One last full-length check so the failure message names the outcome
      // that never appeared, rather than a bare timeout.
      await expect(expectVisible).toBeVisible({ timeout: 1_000 })
      return
    }

    const appeared = await expectVisible
      .waitFor({ state: 'visible', timeout: Math.min(2_000, remaining) })
      .then(() => true)
      .catch(() => false)
    if (appeared) return

    // The click produced nothing yet. Re-click only if the button is still
    // there: if it is gone the click did take effect and something slower —
    // a navigation, a route still compiling — is in flight, so keep waiting.
    if (await target.count()) {
      await target
        .click({ timeout: Math.min(5_000, Math.max(1, deadline - Date.now())) })
        .catch(() => {})
    }
  }
}

export { expect }
