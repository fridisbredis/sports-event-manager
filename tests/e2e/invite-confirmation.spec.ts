import { test, expect, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { OTP_CODE, SEED_TENANT_SLUG } from './fixtures/users'
import {
  INVITE_PHONES,
  SECOND_TENANT_SLUG,
  ensureSecondTenant,
  readOfficialByPhone,
  resetInvitee,
  seedInvite,
  serviceClient,
  tenantIdBySlug,
} from './fixtures/invites'
import { signInThroughUi } from './fixtures/auth'

// AUTH-02 invite confirmation: an invited official becoming a confirmed one.
//
// There are two live paths into this, not one — the e2e-findings note that
// framed them as rival implementations is out of date:
//
//   /invite/[token]   the SMS link. api/officials/route.ts builds it, and
//                     proxy.ts exempts /invite/ from the auth guard so a
//                     signed-out invitee can open it. Consent and name are
//                     collected *before* the OTP step.
//   /confirm-invite   the phone fallback, for an invitee who never opens the
//                     link and just signs in with their number. app/page.tsx
//                     routes a phone-matched, role-less user here. SEC-09
//                     requires consent before confirmOfficialInvite runs, so
//                     this interstitial exists to collect it.
//
// Both are covered below, along with the states only one of them can reach.
//
// These screens are what an official sees on their phone, so the file runs at
// a phone viewport like official-screens.spec.ts.
test.use({ viewport: { width: 390, height: 844 } })

// Every test signs in as a fresh, role-less user, so none of them can reuse
// the storageState cache in fixtures/auth.ts. That cache is the suite's defence
// against GoTrue's rate limits (sms_sent 30/h, token_verifications 30/5min);
// this file spends real sends instead, which is why it stays small and why the
// phones are one-per-test.
let admin: SupabaseClient<Database>

test.beforeAll(() => {
  admin = serviceClient()
})

// officials.phone holds E.164 without the leading '+' (see fixtures/invites.ts),
// and the invite form prints that value verbatim.
function storedPhone(phone: string): string {
  return phone.replace(/^\+/, '')
}

// The privacy consent control is a <button> wrapping the label text and a
// nested <a href="/privacy">. Two consequences, both covered by the A11Y note
// at the bottom of this file:
//
//   1. The nested link leaves the button with no accessible name, so it cannot
//      be addressed by role+name like the rest of the suite — hence hasText.
//   2. The link sits across the button's centre point and calls
//      stopPropagation, so Playwright's default centre click is swallowed and
//      the box never toggles. Click the left edge, where the checkbox is and
//      where a real user aiming at the checkbox would click.
function privacyConsent(page: Page) {
  return page.locator('button', { hasText: 'I accept the' })
}

async function acceptPrivacy(page: Page) {
  await privacyConsent(page).click({ position: { x: 14, y: 20 } })
}

// Drives the OTP step of the *invite* form. It is not the /login form —
// different labels, no country select, and the number is fixed by the token —
// so signInThroughUi cannot be reused here.
async function completeInviteOtp(page: Page) {
  // By placeholder, not by label: the invite form's "6-digit code" <label> has
  // no htmlFor and the <input> no id, so they are not associated and
  // getByLabel finds nothing. (The /login form does associate them, which is
  // why fixtures/auth.ts can use getByLabel there.) Third item in the A11Y
  // note at the bottom of this file.
  const codeField = page.getByPlaceholder('000000')
  await expect(codeField).toBeVisible()
  await codeField.fill(OTP_CODE)
  await page.getByRole('button', { name: 'Verify' }).click()
}

test.describe('AUTH-02 via the SMS token link (/invite/[token])', () => {
  test.beforeEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.tokenLink)
  })

  test.afterEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.tokenLink)
  })

  test('an invited official confirms and becomes confirmed', async ({ page }) => {
    const { token, tenantId } = await seedInvite(admin, INVITE_PHONES.tokenLink, {
      name: 'Token Invitee',
    })

    await page.goto(`/invite/${token}`)

    await expect(page.getByRole('heading', { name: 'Invite confirmation' })).toBeVisible()
    // The phone is shown read-only, straight off the invite row — the invitee
    // never types it, which is what makes the token the proof of identity.
    // Rendered raw rather than through formatPhoneForDisplay, so it appears in
    // the stored shape (no leading '+').
    await expect(page.getByText(storedPhone(INVITE_PHONES.tokenLink))).toBeVisible()

    const confirmButton = page.getByRole('button', { name: 'Confirm availability' })
    // Gated on availability + privacy + a non-empty name. Asserting it starts
    // disabled is the consent gate itself (SEC-09), not just a UI detail.
    await expect(confirmButton).toBeDisabled()

    await page.getByRole('button', { name: 'I am available for this event' }).click()
    await expect(confirmButton).toBeDisabled()

    await acceptPrivacy(page)
    await expect(confirmButton).toBeEnabled()

    // The name arrives prefilled from the invite row; overwrite it so the
    // assertion below proves the form's value was persisted, not the seed's.
    const nameField = page.getByPlaceholder('Full name')
    await expect(nameField).toHaveValue('Token Invitee')
    await nameField.fill('Confirmed Via Token')

    await confirmButton.click()

    await completeInviteOtp(page)

    await expect(page.getByText('You are confirmed')).toBeVisible()

    const official = await readOfficialByPhone(admin, INVITE_PHONES.tokenLink, tenantId)
    expect(official?.invite_status).toBe('confirmed')
    expect(official?.name).toBe('Confirmed Via Token')
    // SEC-09: consent must be recorded, not merely clicked.
    expect(official?.privacy_accepted_at).not.toBeNull()
    // The token is spent — see the invalid-link test below for why that matters.
    expect(official?.invite_token).toBeNull()
    // The officials row is now bound to the auth user that verified the OTP.
    expect(official?.user_id).not.toBeNull()
  })

  test('the success screen leads into the tenant', async ({ page }) => {
    const { token } = await seedInvite(admin, INVITE_PHONES.tokenLink)

    await page.goto(`/invite/${token}`)
    await page.getByRole('button', { name: 'I am available for this event' }).click()
    await acceptPrivacy(page)
    await page.getByPlaceholder('Full name').fill('Goes Home')
    await page.getByRole('button', { name: 'Confirm availability' }).click()
    await completeInviteOtp(page)

    await expect(page.getByText('You are confirmed')).toBeVisible()
    await page.getByRole('button', { name: /Go to home/ }).click()

    // '/' resolves the role the confirm just granted. Landing on the tenant's
    // official home is the end-to-end proof that the grant took effect.
    await expect(page).toHaveURL(new RegExp(`/${SEED_TENANT_SLUG}/home`))
  })

  test('an unknown token shows the invalid-link screen and reveals no tenant', async ({ page }) => {
    await page.goto('/invite/00000000-0000-0000-0000-000000000000')

    await expect(page.getByText('This invite link is invalid or has expired')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible()

    // The page deliberately withholds which organisation an unknown token
    // belonged to; the seed tenant's name must not leak onto this screen.
    await expect(page.getByText('Seed Klubben')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirm availability' })).toHaveCount(0)
  })

  test('an expired token shows the invalid-link screen', async ({ page }) => {
    const { token } = await seedInvite(admin, INVITE_PHONES.tokenLink, {
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    await page.goto(`/invite/${token}`)

    await expect(page.getByText('This invite link is invalid or has expired')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm availability' })).toHaveCount(0)
  })

  test('an already-confirmed token redirects to sign-in', async ({ page }) => {
    const { token, tenantId } = await seedInvite(admin, INVITE_PHONES.tokenLink)

    // Confirm the row out from under the link, the way a second tap on the
    // same SMS link would find it.
    const { error } = await admin
      .from('officials')
      .update({ invite_status: 'confirmed' })
      .eq('invite_token', token)
      .eq('tenant_id', tenantId)
    if (error) throw error

    await page.goto(`/invite/${token}`)

    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('AUTH-02 via the phone fallback (/confirm-invite)', () => {
  test.beforeEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.phoneFallback)
  })

  test.afterEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.phoneFallback)
  })

  test('signing in without opening the link routes to the consent interstitial', async ({
    page,
  }) => {
    const { tenantId } = await seedInvite(admin, INVITE_PHONES.phoneFallback, {
      name: 'Fallback Invitee',
    })

    // No /invite/[token] visit anywhere in this test — that is the distinction
    // between this path and the one above.
    await signInThroughUi(page, INVITE_PHONES.phoneFallback)

    await expect(page).toHaveURL(/\/confirm-invite/)
    await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible()

    const continueButton = page.getByRole('button', { name: 'Continue' })
    // SEC-09 again: consent gates the confirm, and here it is the only gate,
    // since the single pending invite is auto-selected.
    await expect(continueButton).toBeDisabled()

    await acceptPrivacy(page)
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    await expect(page).toHaveURL(new RegExp(`/${SEED_TENANT_SLUG}/home`))

    const official = await readOfficialByPhone(admin, INVITE_PHONES.phoneFallback, tenantId)
    expect(official?.invite_status).toBe('confirmed')
    expect(official?.privacy_accepted_at).not.toBeNull()
    expect(official?.user_id).not.toBeNull()
    // The name was never asked for on this path, so the invite's name stands.
    expect(official?.name).toBe('Fallback Invitee')
  })

  test('a signed-out visitor is sent to sign-in', async ({ page }) => {
    await page.goto('/confirm-invite')

    // The page re-checks the session itself rather than trusting the referrer.
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('AUTH-02 multi-tenant and expiry states on /confirm-invite', () => {
  test.beforeEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.multiTenant)
    await resetInvitee(admin, INVITE_PHONES.expired)
  })

  test.afterEach(async () => {
    await resetInvitee(admin, INVITE_PHONES.multiTenant)
    await resetInvitee(admin, INVITE_PHONES.expired)
  })

  test('pending invites in two tenants render a picker and confirm only the chosen one', async ({
    page,
  }) => {
    const seedTenantId = await tenantIdBySlug(admin, SEED_TENANT_SLUG)
    const secondTenantId = await ensureSecondTenant(admin)

    await seedInvite(admin, INVITE_PHONES.multiTenant, { tenantId: seedTenantId })
    await seedInvite(admin, INVITE_PHONES.multiTenant, { tenantId: secondTenantId })

    await signInThroughUi(page, INVITE_PHONES.multiTenant)
    await expect(page).toHaveURL(/\/confirm-invite/)

    await expect(
      page.getByText('You have pending invites from multiple organizations')
    ).toBeVisible()

    const options = page.getByRole('radio')
    await expect(options).toHaveCount(2)
    // With two invites neither is auto-selected, so consent alone must not be
    // enough to enable the confirm.
    await acceptPrivacy(page)
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await page.getByRole('radio', { name: 'Select E2E Invite Klubben' }).click()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page).toHaveURL(new RegExp(`/${SECOND_TENANT_SLUG}/home`))

    const chosen = await readOfficialByPhone(admin, INVITE_PHONES.multiTenant, secondTenantId)
    expect(chosen?.invite_status).toBe('confirmed')

    // The invite that was not chosen must be untouched — confirming one tenant
    // is not consent for another.
    const other = await readOfficialByPhone(admin, INVITE_PHONES.multiTenant, seedTenantId)
    expect(other?.invite_status).toBe('invited')
    expect(other?.privacy_accepted_at).toBeNull()
  })

  test('an all-expired invite shows the expired state instead of a consent form', async ({
    page,
  }) => {
    await seedInvite(admin, INVITE_PHONES.expired, {
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    // page.tsx's redirect gate is expiry-blind on purpose, so this user still
    // lands here — and this screen is what stops them.
    await signInThroughUi(page, INVITE_PHONES.expired)

    await expect(page).toHaveURL(/\/confirm-invite/)
    await expect(page.getByText('This invite has expired')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)

    const official = await readOfficialByPhone(admin, INVITE_PHONES.expired)
    expect(official?.invite_status).toBe('invited')
  })
})

// A11Y, found while writing this spec — the privacy-consent control on both
// /invite/[token] and /confirm-invite nests <a href="/privacy"> inside the
// <button>, and that one structural choice breaks it two ways:
//
//   - No accessible name. A button containing a link derives no name from its
//     own text, so a screen reader announces an unnamed button for the single
//     control gating SEC-09 consent.
//   - Unclickable at its centre. The link spans the middle of the button and
//     calls stopPropagation, so a click there is swallowed. Only the edges
//     toggle consent. A sighted mouse user aiming at the words "privacy
//     policy" — a reasonable thing to do — hits the link; aiming at the
//     checkbox works. On a 390px-wide phone the link covers much of the row.
//
// The tests above work around both (hasText, and a left-edge click position),
// which is why they do not use plain getByRole + click like the rest of the
// suite.
//
// Separately, on the invite form's OTP step the "6-digit code" <label> carries
// no htmlFor and the <input> no id, so they are never associated: the field's
// only accessible name is its "000000" placeholder, and a screen reader user
// hears the placeholder rather than the label. /login's own OTP field does
// associate the two — this is a divergence in the invite form, not a
// house style.
//
// Worth a Trello card covering all three: move the policy link out of the
// consent button, give that button an aria-label, and wire up htmlFor/id on
// the OTP field. That would let these selectors become ordinary getByRole /
// getByLabel calls.
