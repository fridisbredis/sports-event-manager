import { notFound } from 'next/navigation'
import { getAdminTenant } from '@/lib/auth/tenant'
import { hasFeature } from '@/lib/tiers/features'
import { effectivePalette } from '@/lib/theme/tenant-theme-style'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { ColorThemeForm } from './_components/color-theme-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// N23: the tenant's own settings — what applies across every event rather
// than to one. Only the colour theme so far; it used to live on an event's
// configuration page, from where it restyled all the tenant's events at once.
export default async function TenantSettingsPage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation(await getUserLanguage(), 'admin')

  // Memoised: the layout already resolved and authorised this tenant.
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mb-8 border-b border-edge pb-5">
        <h1 className="page-title">{t('settings.title')}</h1>
        <p className="mt-1.5 text-[14.5px] text-ink-muted">{t('settings.subtitle')}</p>
      </div>

      <div className="max-w-xl">
        <ColorThemeForm
          tenantSlug={tenantSlug}
          tenantId={tenant.id}
          // The EFFECTIVE palette, not the stored one: below the unlocking tier
          // the page renders the default, and the picker must agree with what
          // is on screen rather than advertise a theme that is not in use.
          initialColorPalette={effectivePalette(tenant)}
          canChooseColorTheme={hasFeature(tenant.tier, 'colorTheme')}
        />
      </div>
    </div>
  )
}
