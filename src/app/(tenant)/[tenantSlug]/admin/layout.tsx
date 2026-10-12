import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getAdminTenant, hasAccountScreen } from '@/lib/auth/tenant'
import { SidebarNav } from './_components/sidebar-nav'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// The parts of the layout that need the user resolved: the tenant's theme
// colours and the sidebar's tab set.
//
// Split out of the layout body and suspended, because loading.tsx sits BELOW
// layout.tsx in the component hierarchy and therefore cannot show a fallback
// for runtime data the layout itself awaits. With the auth reads inline, a
// page change blocked here before any skeleton could render and before the
// URL changed — the screen simply froze for the length of the round trip.
// Next documents this under layout.js "Interaction with loading.js".
//
// This is defense in depth, not the only gate: every page below runs the same
// resolution and answers redirect/notFound itself, so suspending this does
// not widen what an unauthorised caller can reach. It only stops the chrome
// from holding the whole navigation hostage.
export async function AdminChrome({ tenantSlug }: { tenantSlug: string }) {
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Resolves the tenant only once the caller has passed the admin access
  // check. Memoised per render pass (F-PERF-07), so the pages below reuse
  // this result instead of repeating the GoTrue round trip and the two
  // access-context queries.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // ACCT-01 is backed by an `officials` row, which an admin who reaches this
  // tenant by role alone does not have — see hasAccountScreen.
  const showAccount = await hasAccountScreen(tenantSlug)

  return (
    <>
      <TenantThemeStyle colorPalette={tenant.color_palette ?? 'blue'} />
      <SidebarNav
        tenantSlug={tenantSlug}
        adminLabel={t('navigation.adminLabel')}
        showAccount={showAccount}
      />
    </>
  )
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  return (
    <div className="app-surface flex min-h-screen">
      {/* No fallback: the sidebar is chrome, and a grey unclickable rail
          reads worse than the real one arriving a moment later. On a page
          change it is already mounted and stays put — only the first load
          has nothing to show here. */}
      <Suspense>
        <AdminChrome tenantSlug={tenantSlug} />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
