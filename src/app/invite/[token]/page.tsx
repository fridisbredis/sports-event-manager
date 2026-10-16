import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { effectivePalette, TenantThemeStyle } from '@/lib/theme/tenant-theme-style'
import InviteForm from './_components/invite-form'

interface Props {
  params: Promise<{ token: string }>
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params
  const service = await createSupabaseServiceClient()

  // The tenant's palette comes along with the invite row: this page sits
  // outside every tenant-scoped layout, so nothing above it mounts
  // TenantThemeStyle, and without this --tenant-* would be undefined and any
  // themed element would render unpainted. The token already identifies the
  // tenant, so no extra lookup is needed to know which palette to use.
  const { data: official } = await service
    .from('officials')
    .select(
      'phone, name, invite_status, invite_token_expires_at, tenants(name, color_palette, tier)'
    )
    .eq('invite_token', token)
    .maybeSingle()

  if (official?.invite_status === 'confirmed') {
    redirect('/login')
  }

  const isValid =
    official &&
    official.invite_status === 'invited' &&
    official.invite_token_expires_at !== null &&
    new Date(official.invite_token_expires_at) > new Date()

  // Only for a valid invite. An expired or unknown token shows a generic
  // "invalid link" screen that deliberately reveals nothing about which
  // organisation it belonged to, and a themed colour would leak exactly that.
  // Goes through effectivePalette like every other themed surface: the theme
  // is tier-gated, so an invite into a tenant below the minimum tier must
  // render the default palette rather than the one stored on its row.
  const tenant = official?.tenants as {
    name: string
    color_palette: string | null
    tier: string
  } | null
  const palette = isValid && tenant ? effectivePalette(tenant) : null

  return (
    <>
      {palette && <TenantThemeStyle colorPalette={palette} />}
      {/* tenantName follows the same rule as the palette above: passed only for
          a valid invite, so an expired or unknown token cannot be used to probe
          which organisation a link belonged to. */}
      <InviteForm
        token={token}
        phone={isValid ? official.phone : null}
        name={isValid ? official.name : null}
        tenantName={isValid ? (tenant?.name ?? null) : null}
      />
    </>
  )
}
