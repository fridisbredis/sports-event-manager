import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'
import { AdminViewLink } from './_components/admin-view-link'
import { BottomTabBar } from './_components/bottom-tab-bar'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// The parts of the layout that need the user resolved: the tenant's theme
// colours, the admin link, and which tabs the bottom bar shows.
//
// Split out of the layout body and suspended, because loading.tsx sits BELOW
// layout.tsx in the component hierarchy and therefore cannot show a fallback
// for runtime data the layout itself awaits. With the auth reads inline, a
// tab change blocked here before any skeleton could render and before the URL
// changed — the screen simply froze for the length of the round trip, which
// is what the skeletons were added to fix and did not.
//
// This is defense in depth, not the only gate: every page below runs the same
// resolution and answers redirect/notFound itself, so suspending this does
// not widen what an unauthorised caller can reach. It only stops the chrome
// from holding the whole navigation hostage.
export async function OfficialChrome({ tenantSlug }: { tenantSlug: string }) {
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07), so the pages below share this one
  // GoTrue round trip and access-context lookup rather than repeating them.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // ACCT-01 is backed by an `officials` row. An admin who reaches this tenant
  // by role alone has none, and the account page below answers notFound() for
  // them — so the tab would lead nowhere.
  const showAccount = tenant.officialId != null

  // An admin reaching an official screen gets a way back to their own
  // surface. Costs one admin-access check here and is memoised like the rest.
  const showAdminLink = await hasAdminScreens(tenantSlug)

  return (
    <>
      <TenantThemeStyle colorPalette={tenant.color_palette} />
      {showAdminLink && <AdminViewLink tenantSlug={tenantSlug} />}
      <BottomTabBar tenantSlug={tenantSlug} showAccount={showAccount} />
    </>
  )
}

export default async function OfficialLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* No fallback: the bar and the admin link are chrome, and a grey
          placeholder bar that cannot be tapped is worse than the real one
          arriving a moment later. On a tab change it is already on screen
          and stays there — only the first load has nothing to show here. */}
      <Suspense>
        <OfficialChrome tenantSlug={tenantSlug} />
      </Suspense>
      <div className="flex-1 pb-16">{children}</div>
    </div>
  )
}
