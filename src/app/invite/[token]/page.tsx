import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'
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
    .select('phone, name, invite_status, invite_token_expires_at, tenants(color_palette)')
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
  const palette = isValid
    ? ((official.tenants as { color_palette: string | null } | null)?.color_palette ?? 'blue')
    : null

  return (
    <>
      {palette && <TenantThemeStyle colorPalette={palette} />}
      <InviteForm
        token={token}
        phone={isValid ? official.phone : null}
        name={isValid ? official.name : null}
      />
    </>
  )
}
