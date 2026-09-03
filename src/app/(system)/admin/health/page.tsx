import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { StatusCard } from './_components/status-card'
import { fetchSupabaseStatus, fetchTwilioStatus, fetchSentryStatus } from './_lib/fetch-status'
import {
  currentSupabaseProjectRef,
  AZURE_DEV_RESOURCE_GROUP,
  AZURE_PROD_RESOURCE_GROUP,
  azurePortalResourceGroupUrl,
} from './_lib/constants'

export default async function SystemHealthPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const [supabase, twilio, sentry] = await Promise.all([
    fetchSupabaseStatus(),
    fetchTwilioStatus(),
    fetchSentryStatus(),
  ])
  const supabaseProjectRef = currentSupabaseProjectRef()
  const isLocalSupabase = supabaseProjectRef === 'local (Docker)'
  // process.env.SENTRY_PROJECT, not a value from fetchSentryStatus — the
  // point is to name which project the count below is even for, so it must
  // come from the same place fetchSentryStatus reads it from, independent of
  // whether the probe succeeded.
  const sentryProjectName = process.env.SENTRY_PROJECT

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
            { label: 'Projekt', value: supabaseProjectRef },
            { label: 'PostgREST-fråga', value: supabase.status === 'ok' ? 'OK' : 'Fel' },
          ]}
          note="Testar bara att en enkel fråga mot projektet ovan lyckas — inte något annat projekt, och ett totalt Auth-haveri hade gett en 404 innan sidan ens laddar, inte ett rött kort här."
          links={
            isLocalSupabase
              ? [{ label: 'Alla projekt', href: 'https://supabase.com/dashboard/projects' }]
              : [
                  {
                    label: 'Öppna i Supabase Dashboard',
                    href: `https://supabase.com/dashboard/project/${supabaseProjectRef}`,
                  },
                  { label: 'Alla projekt', href: 'https://supabase.com/dashboard/projects' },
                ]
          }
        />

        <StatusCard
          title="Twilio"
          status={twilio.status}
          facts={
            twilio.status === 'ok'
              ? [
                  { label: 'Avsändarnummer', value: twilio.fromNumber ?? '—' },
                  { label: 'SMS idag (detta nummer)', value: String(twilio.sentToday ?? 0) },
                ]
              : undefined
          }
          note={
            twilio.status === 'ok'
              ? 'Dev och prod har egna avsändarnummer — siffran ovan gäller bara numret som visas. (Enligt CLAUDE.md delar de ett Twilio-konto, men det är inte oberoende verifierat.)'
              : twilio.status === 'unknown'
                ? 'Kunde inte hämta live-data just nu — se konsolen för aktuell status.'
                : undefined
          }
          links={[{ label: 'Twilio-konsol', href: 'https://console.twilio.com/' }]}
        />

        <StatusCard
          title="Sentry"
          status={sentry.status}
          facts={
            sentry.status === 'ok'
              ? [
                  { label: 'Projekt', value: sentryProjectName ?? '—' },
                  { label: 'Olösta (24h)', value: String(sentry.unresolvedCount ?? 0) },
                ]
              : undefined
          }
          note={
            sentry.status === 'unknown'
              ? 'Kunde inte hämta live-data just nu — se konsolen för aktuell status.'
              : 'Visar bara projektet denna miljö (dev eller prod) rapporterar till, inte det andra.'
          }
          links={[
            {
              label: sentryProjectName
                ? `Olösta i ${sentryProjectName} ↗`
                : 'Öppna olösta issues i Sentry',
              // Project-scoped URL (slug-based), same base as the two
              // overview links below — verified 2026-09-02 to resolve
              // (200). The newer org-wide /issues/ stream filters by numeric
              // project id, not slug, and that id isn't available from any
              // env var this app has, so it isn't used here.
              href: `https://extrapreneur.sentry.io/projects/${sentryProjectName ?? 'viadal-event-dev'}/?query=is%3Aunresolved&statsPeriod=24h`,
            },
            {
              label: 'viadal-event-dev (projektöversikt)',
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-dev/',
            },
            {
              label: 'viadal-event-prod (projektöversikt)',
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-prod/',
            },
          ]}
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
