import { test, expect, signInThroughUi } from './fixtures/auth'
import { USERS, SEED_TENANT_SLUG } from './fixtures/users'

// AUTH-01 — Sign in.
// Role: everyone. The spec's most valuable assertion is the role-based redirect
// after verify, so each role signs in for real here rather than replaying a
// cached session.
test.describe('AUTH-01 sign in', () => {
  test('unauthenticated visitor is sent to /login', async ({ page }) => {
    await page.goto(`/${SEED_TENANT_SLUG}/admin/dashboard`)
    await expect(page).toHaveURL(/\/login/)
  })

  test('phone step rejects a malformed number before sending', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Phone number').fill('123')

    // isValidPhoneForCountry() fails, so the button never enables and no OTP
    // is ever requested — the client-side gate before the rate limiter.
    await expect(page.getByRole('button', { name: 'Send code' })).toBeDisabled()
    await expect(
      page.getByText('Enter a valid mobile number for the selected country.')
    ).toBeVisible()
  })

  test('a wrong code keeps the user on the OTP step', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Phone number').fill(USERS.tenantAdmin.phone)
    await page.getByRole('button', { name: 'Send code' }).click()

    await page.getByLabel('6-digit code').fill('999999')
    await page.getByRole('button', { name: 'Verify' }).click()

    // GoTrue reports otp_expired for both a mistyped and an expired code; the
    // page maps it to signIn.invalidCode and stays put.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('6-digit code')).toBeVisible()
  })

  // The core of the screen: primary role decides the landing screen
  // (resolvePostLoginRedirect, ROLE_PRIORITY system_admin > tenant_admin >
  // official > participant).
  for (const [role, user] of Object.entries(USERS)) {
    test(`${role} lands on ${user.landingPath} after verifying`, async ({ page }) => {
      await signInThroughUi(page, user.phone)
      await expect(page).toHaveURL(new RegExp(`${user.landingPath}$`))
    })
  }
})
