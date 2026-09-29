import { ShieldCheck } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getUserRoles } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { SidebarNav } from './_components/sidebar-nav'

interface Props {
  children: React.ReactNode
}

// "Back to tenant admin" needs somewhere to go. A system_admin granted
// globally (tenant_id = null) administers no tenant of their own, so there is
// no slug on their role row to use — fall back to the most recently created
// active tenant, which is what they would have been looking at anyway. Returns
// null when neither exists, and the sidebar then omits the link rather than
// rendering a dead one.
async function resolveTenantAdminHref(): Promise<string | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const roles = await getUserRoles(user.id)
  const ownTenant = roles.find((role) => role.role === 'tenant_admin' && role.tenantSlug)
  if (ownTenant) return `/${ownTenant.tenantSlug}/admin/dashboard`

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tenants')
    .select('slug')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data?.slug ? `/${data.slug}/admin/dashboard` : null
}

export default async function SystemAdminLayout({ children }: Props) {
  const t = await getServerTranslation('en', 'admin')
  const backToTenantHref = await resolveTenantAdminHref()

  return (
    <div className="app-surface flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-edge bg-white">
        <div className="flex items-center justify-between border-b border-edge-soft px-6 py-5">
          <span className="section-label">{t('systemAdmin.sidebarLabel')}</span>
          <ShieldCheck className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
        </div>
        <SidebarNav
          backToTenantHref={backToTenantHref}
          labels={{
            tenants: t('systemAdmin.tenants'),
            backToTenantAdmin: t('systemAdmin.backToTenantAdmin'),
            logOut: t('systemAdmin.logOut'),
          }}
        />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
