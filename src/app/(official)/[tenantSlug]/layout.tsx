import { Suspense } from 'react'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getOfficialTenant, hasAdminScreens } from '@/lib/auth/tenant'
import { AdminViewLink } from './_components/admin-view-link'
import { BottomTabBar } from './_components/bottom-tab-bar'
import { getSoleOfficialEventId } from '@/lib/events/official-event'
import { effectivePalette, TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// The cross-surface link, which the gate below does not need.
//
// An admin who is also on the roster gets a way back to their own surface.
// No route's reachability depends on this answer, so suspending it costs no
// guarantee — unlike the access check itself, which stays in the layout body.
export async function AdminLinkChrome({ tenantSlug }: { tenantSlug: string }) {
  const showAdminLink = await hasAdminScreens(tenantSlug)

  return showAdminLink ? <AdminViewLink tenantSlug={tenantSlug} /> : null
}

export default async function OfficialLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // This layout gates every screen beneath it. The pages also resolve the
  // tenant through the same guarded helper, so the check runs on both — but
  // it is memoised per render pass (F-PERF-07), so it costs one GoTrue round
  // trip and one access-context lookup for the whole render, not two.
  //
  // This await is deliberately in the layout body and must stay there, even
  // though it costs the instant navigation a loading.tsx would otherwise buy.
  // notFound() terminates the segment it is thrown in: once a Suspense shell
  // has started streaming, the 200 is already on the wire and an unauthorised
  // caller gets a 404 body under a 200 status. The e2e access-control suite
  // asserts the status, and is right to — that is the part a client or a
  // crawler acts on. Reachability is not a thing to trade for a skeleton.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // ACCT-01 is backed by an `officials` row. An admin who reaches this tenant
  // by role alone has none, and the account page below answers notFound() for
  // them — so the tab would lead nowhere. Reuses the resolution above rather
  // than asking again (F-PERF-07).
  const showAccount = tenant.officialId != null
  // N23: where the event tabs point on a screen without an event in its URL.
  const defaultEventId = await getSoleOfficialEventId(tenantSlug)

  return (
    <>
      <TenantThemeStyle colorPalette={effectivePalette(tenant)} />
      <div className="flex flex-col min-h-screen bg-white">
        {/* Suspended because it is chrome, not a gate: no fallback, since the
            link appearing a moment late is better than a grey bar where it
            will be. */}
        <Suspense>
          <AdminLinkChrome tenantSlug={tenantSlug} />
        </Suspense>
        <div className="flex-1 pb-16">{children}</div>
        <BottomTabBar
          tenantSlug={tenantSlug}
          showAccount={showAccount}
          defaultEventId={defaultEventId}
        />
      </div>
    </>
  )
}
