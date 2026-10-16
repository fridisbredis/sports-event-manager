import { test, expect } from './fixtures/auth'
import { SEED_TENANT_SLUG } from './fixtures/users'
import { serviceClient, tenantIdBySlug } from './fixtures/invites'

// N18: the read-only coverage view an admin opens on a phone while standing at
// the event. The whole point is the narrow viewport, so the whole file runs at
// one — same 390x844 as official-screens.spec.ts. scheduling.spec.ts covers the
// editable grid and deliberately runs wide (1680), so the two cannot share a
// file.
test.use({ viewport: { width: 390, height: 844 } })

const url = `/${SEED_TENANT_SLUG}/admin/scheduling`

// The desktop grid stays in the DOM below the breakpoint, hidden, and
// renders the same work-area names — so assertions address the mobile
// view's own region rather than whichever copy resolves first.
const coverage = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Coverage' })

// The seed tenant is 'standard' (scripts/seed-dev.ts) and this view is Premium
// and up, so every test here sets the tier it needs and puts it back
// afterwards.
//
// Per test rather than once per file: the tier-gate test below has to run on
// 'standard', so a file-level raise would be fighting it, and a test that
// depended on having run before or after it would be ordering-sensitive in a
// way nothing in the file makes visible. Each test owning its own tier costs
// two extra writes and removes that entirely.
let tenantId: string

async function setTier(tier: 'standard' | 'premium') {
  const admin = serviceClient()
  tenantId ??= await tenantIdBySlug(admin, SEED_TENANT_SLUG)
  const { error } = await admin.from('tenants').update({ tier }).eq('id', tenantId)
  if (error) throw error
}

// Always leave the tenant as the seed built it, whatever a test did.
test.afterEach(async () => {
  await setTier('standard')
})

test.describe('N18 mobile coverage view', () => {
  test('replaces the editable grid at phone width', async ({ tenantAdminPage: page }) => {
    await setTier('premium')
    await page.goto(url)

    await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible()
    // Says why there is nothing to tap, before the admin goes looking for an
    // edit affordance that is not there.
    await expect(page.getByText(/Read-only/)).toBeVisible()

    // The grid is rendered but hidden by the breakpoint: same route, same
    // data, swapped by CSS. Its own toolbar must not be reachable here — a
    // visible drag-picker at this width would mean the gate leaked.
    await expect(page.getByRole('tab', { name: 'By person' })).toBeHidden()
  })

  test('shows who is working each work area, and flags the ones nobody is on', async ({
    tenantAdminPage: page,
  }) => {
    await setTier('premium')
    await page.goto(url)

    // seed-dev.ts gives each race day two work areas with the same two names,
    // and assigns +46709900002 across three days.
    const view = coverage(page)
    await expect(view.getByRole('heading', { name: 'Finish line' })).toBeVisible()
    await expect(view.getByRole('heading', { name: 'Water station' })).toBeVisible()

    // Whichever of the two the seed leaves empty, one of these must appear —
    // an unstaffed work area is the thing this screen exists to surface, and
    // rendering it as merely blank would be the defect.
    const staffed = view.getByText(/\d{2}:\d{2}\u2013\d{2}:\d{2}/)
    const unstaffed = view.getByText('Nobody assigned')
    await expect(staffed.or(unstaffed).first()).toBeVisible()
  })

  // The seed builds one single-day stage per race day (scripts/seed-dev.ts),
  // so a stage never has more than one allocable day and the tab row cannot
  // render here — the single-day label is the real behaviour at this seed.
  // The multi-day tab path is covered by the component test instead; giving
  // the seed a multi-day stage is N12's open item, and would light this up.
  test('names the day on screen, since the times carry no date', async ({
    tenantAdminPage: page,
  }) => {
    await setTier('premium')
    await page.goto(url)

    await expect(coverage(page).getByText(/^\w{3}, \d{1,2} \w{3}$/)).toBeVisible()
    await expect(coverage(page).getByRole('navigation', { name: 'Day' })).toHaveCount(0)
  })

  test('the desktop grid still takes over above the breakpoint', async ({
    tenantAdminPage: page,
  }) => {
    await setTier('premium')
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(url)

    await expect(page.getByRole('tab', { name: 'By person' })).toBeVisible()
    await expect(coverage(page)).toBeHidden()
  })
})

test.describe('N18 tier gate', () => {
  test('a Standard tenant is told where to find the schedule instead', async ({
    tenantAdminPage: page,
  }) => {
    // No setTier here: 'standard' is what the seed ships, and afterEach puts
    // it back regardless.
    await page.goto(url)

    await expect(page.getByText('Available from Premium')).toBeVisible()
    // Nothing from the coverage read may reach a tenant below the tier.
    await expect(coverage(page)).toHaveCount(0)
    await expect(page.getByText('Nobody assigned')).toHaveCount(0)
  })
})
