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

// This view is Premium and up, so each test sets the tier it needs. Per test
// rather than once per file: the tier-gate test below has to run on
// 'standard', so a file-level raise would be fighting it, and a test that
// depended on having run before or after it would be ordering-sensitive in a
// way nothing in the file makes visible.
//
// The tier is READ before the first change and restored to whatever it was,
// never to a hardcoded 'standard'. The dev stack these specs run against is
// also the one being clicked around in by hand, and an afterEach that asserts
// what the seed ships silently undoes a tier set in the system-admin UI — it
// did exactly that once, which is why this reads instead of assuming.
let tenantId: string
let originalTier: string | null = null

async function setTier(tier: 'standard' | 'premium') {
  const admin = serviceClient()
  if (!tenantId) {
    tenantId = await tenantIdBySlug(admin, SEED_TENANT_SLUG)
    const { data, error } = await admin.from('tenants').select('tier').eq('id', tenantId).single()
    if (error) throw error
    originalTier = data.tier
  }
  const { error } = await admin.from('tenants').update({ tier }).eq('id', tenantId)
  if (error) throw error
}

// Put back whatever the tenant was on before this file ran, so a stack
// someone has configured by hand survives a test run.
test.afterEach(async () => {
  if (!tenantId || originalTier === null) return
  const { error } = await serviceClient()
    .from('tenants')
    .update({ tier: originalTier })
    .eq('id', tenantId)
  if (error) throw error
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
    // Explicitly, rather than relying on the tenant already being there: the
    // tier is whatever the stack was left on, and afterEach restores it.
    await setTier('standard')
    await page.goto(url)

    await expect(page.getByText('Available from Premium')).toBeVisible()
    // Nothing from the coverage read may reach a tenant below the tier.
    await expect(coverage(page)).toHaveCount(0)
    await expect(page.getByText('Nobody assigned')).toHaveCount(0)
  })
})

// The admin rail is hidden below md, so this drawer is the whole of the admin
// navigation on a phone. Its own describe rather than a new file: it shares
// this file's phone viewport, and it exists because N18 hid the rail.
test.describe('admin navigation on a phone', () => {
  test('the hamburger opens a drawer with the full admin nav', async ({
    tenantAdminPage: page,
  }) => {
    await page.goto(`/${SEED_TENANT_SLUG}/admin/dashboard`)

    // The rail itself must be gone — it is what left 94px of a 390px screen.
    await expect(page.getByRole('complementary')).toBeHidden()

    await page.getByRole('button', { name: 'Open menu' }).click()

    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    // Every rail destination, not a reduced set: a phone user who can only
    // reach half the admin screens is barely better off than one who can
    // reach none.
    for (const label of [
      'Dashboard',
      'Event configuration',
      'Work areas',
      'Officials',
      'Scheduling',
      'Communication',
      'Official view',
    ]) {
      await expect(drawer.getByRole('link', { name: label })).toBeVisible()
    }
    await expect(drawer.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  test('tapping a link navigates and closes the drawer', async ({ tenantAdminPage: page }) => {
    await page.goto(`/${SEED_TENANT_SLUG}/admin/dashboard`)
    await page.getByRole('button', { name: 'Open menu' }).click()

    const drawer = page.getByRole('dialog')
    await drawer.getByRole('link', { name: 'Officials' }).click()

    await expect(page).toHaveURL(new RegExp(`/${SEED_TENANT_SLUG}/admin/officials`))
    // Closed explicitly on tap rather than by a route-change effect, so that
    // tapping the current page's own link cannot leave it open over nothing.
    await expect(drawer).toBeHidden()
  })

  test('the drawer marks the page you are on', async ({ tenantAdminPage: page }) => {
    await page.goto(`/${SEED_TENANT_SLUG}/admin/officials`)
    await page.getByRole('button', { name: 'Open menu' }).click()

    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('link', { name: 'Officials' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(drawer.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('neither hamburger nor drawer exists on desktop, where the rail is back', async ({
    tenantAdminPage: page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/${SEED_TENANT_SLUG}/admin/dashboard`)

    await expect(page.getByRole('complementary')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
  })
})
