import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { StatusCard } from './_components/status-card'
import { fetchSupabaseStatus, fetchTwilioStatus } from './_lib/fetch-status'
import {
  devSupabaseProjectRef,
  AZURE_DEV_RESOURCE_GROUP,
  AZURE_PROD_RESOURCE_GROUP,
  azurePortalResourceGroupUrl,
} from './_lib/constants'

export default async function SystemHealthPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const [supabase, twilio] = await Promise.all([fetchSupabaseStatus(), fetchTwilioStatus()])

  return (
    <div className="p-8 max-w-5xl">
      <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
        ← Tenants
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-1 mt-3">Systemstatus</h1>
      <p className="text-sm text-gray-500 mb-6">
        Snabb överblick över drift dev/prod. Vissa mätvärden är live, andra länkar vidare till
        tjänstens egen konsol.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatusCard
          title="Supabase"
          status={supabase.status}
          facts={[
            { label: 'PostgREST-fråga (dev)', value: supabase.status === 'ok' ? 'OK' : 'Fel' },
          ]}
          note="Testar bara att en enkel fråga mot dev-projektet lyckas — kan inte se prod, och ett totalt Auth-haveri hade gett en 404 innan sidan ens laddar, inte ett rött kort här."
          links={[
            {
              label: 'Dev dashboard',
              href: `https://supabase.com/dashboard/project/${devSupabaseProjectRef()}`,
            },
            { label: 'Alla projekt (välj prod)', href: 'https://supabase.com/dashboard/projects' },
          ]}
        />

        <StatusCard
          title="Twilio"
          status={twilio.status}
          facts={
            twilio.status === 'ok'
              ? [{ label: 'SMS idag', value: String(twilio.sentToday ?? 0) }]
              : undefined
          }
          note={
            twilio.status === 'unknown'
              ? 'Kunde inte hämta live-data just nu — se konsolen för aktuell status.'
              : undefined
          }
          links={[{ label: 'Twilio-konsol', href: 'https://console.twilio.com/' }]}
        />

        <StatusCard
          title="Sentry"
          links={[
            {
              label: 'viadal-event-dev',
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-dev/',
            },
            {
              label: 'viadal-event-prod',
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-prod/',
            },
          ]}
          note="Live felstatistik kräver en separat Sentry API-token (nuvarande token är endast för source maps)."
        />

        <StatusCard
          title="Azure Container Apps"
          links={[
            {
              label: 'Dev — Azure Portal',
              href: azurePortalResourceGroupUrl(AZURE_DEV_RESOURCE_GROUP),
            },
            {
              label: 'Prod — Azure Portal',
              href: azurePortalResourceGroupUrl(AZURE_PROD_RESOURCE_GROUP),
            },
          ]}
          note="Ingen Azure-SDK/credential finns i appen ännu — status hämtas via länk tills vidare."
        />

        <StatusCard
          title="GitHub Actions"
          links={[
            {
              label: 'Deploy-körningar',
              href: 'https://github.com/fridisbredis/sports-event-manager/actions',
            },
          ]}
          note="Senaste körning för deploy-dev.yml / deploy-prod.yml."
        />
      </div>
    </div>
  )
}
