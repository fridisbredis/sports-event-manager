import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
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

  const t = await getServerTranslation('en', 'admin')
  const statusLabels = {
    ok: t('health.status.ok'),
    error: t('health.status.error'),
    unknown: t('health.status.unknown'),
  }

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
        {t('health.backToTenants')}
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 mb-1 mt-3">{t('health.title')}</h1>
      <p className="text-sm text-gray-500 mb-6">{t('health.subtitle')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatusCard
          title={t('health.supabase.title')}
          status={supabase.status}
          statusLabels={statusLabels}
          facts={[
            { label: t('health.supabase.project'), value: supabaseProjectRef },
            {
              label: t('health.supabase.postgrestQuery'),
              value:
                supabase.status === 'ok' ? t('health.supabase.ok') : t('health.supabase.error'),
            },
          ]}
          note={t('health.supabase.note')}
          links={
            isLocalSupabase
              ? [
                  {
                    label: t('health.supabase.allProjects'),
                    href: 'https://supabase.com/dashboard/projects',
                  },
                ]
              : [
                  {
                    label: t('health.supabase.openInDashboard'),
                    href: `https://supabase.com/dashboard/project/${supabaseProjectRef}`,
                  },
                  {
                    label: t('health.supabase.allProjects'),
                    href: 'https://supabase.com/dashboard/projects',
                  },
                ]
          }
        />

        <StatusCard
          title={t('health.twilio.title')}
          status={twilio.status}
          statusLabels={statusLabels}
          facts={
            twilio.status === 'ok'
              ? [
                  { label: t('health.twilio.fromNumber'), value: twilio.fromNumber ?? '—' },
                  {
                    label: t('health.twilio.sentToday'),
                    value: String(twilio.sentToday ?? 0),
                  },
                ]
              : undefined
          }
          note={
            twilio.status === 'ok'
              ? t('health.twilio.noteOk')
              : twilio.status === 'unknown'
                ? t('health.twilio.noteUnknown')
                : undefined
          }
          links={[{ label: t('health.twilio.console'), href: 'https://console.twilio.com/' }]}
        />

        <StatusCard
          title={t('health.sentry.title')}
          status={sentry.status}
          statusLabels={statusLabels}
          facts={
            sentry.status === 'ok'
              ? [
                  { label: t('health.sentry.project'), value: sentryProjectName ?? '—' },
                  {
                    label: t('health.sentry.unresolved24h'),
                    value: String(sentry.unresolvedCount ?? 0),
                  },
                ]
              : undefined
          }
          note={
            sentry.status === 'unknown' ? t('health.sentry.noteUnknown') : t('health.sentry.noteOk')
          }
          links={[
            {
              label: sentryProjectName
                ? t('health.sentry.unresolvedIn', { project: sentryProjectName })
                : t('health.sentry.openUnresolved'),
              // Project-scoped URL (slug-based), same base as the two
              // overview links below — verified 2026-09-02 to resolve
              // (200). The newer org-wide /issues/ stream filters by numeric
              // project id, not slug, and that id isn't available from any
              // env var this app has, so it isn't used here.
              href: `https://extrapreneur.sentry.io/projects/${sentryProjectName ?? 'viadal-event-dev'}/?query=is%3Aunresolved&statsPeriod=24h`,
            },
            {
              label: t('health.sentry.devProjectOverview'),
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-dev/',
            },
            {
              label: t('health.sentry.prodProjectOverview'),
              href: 'https://extrapreneur.sentry.io/projects/viadal-event-prod/',
            },
          ]}
        />

        <StatusCard
          title={t('health.azure.title')}
          links={[
            {
              label: t('health.azure.devPortal'),
              href: azurePortalResourceGroupUrl(AZURE_DEV_RESOURCE_GROUP),
            },
            {
              label: t('health.azure.prodPortal'),
              href: azurePortalResourceGroupUrl(AZURE_PROD_RESOURCE_GROUP),
            },
          ]}
          note={t('health.azure.note')}
        />

        <StatusCard
          title={t('health.githubActions.title')}
          links={[
            {
              label: t('health.githubActions.deployRuns'),
              href: 'https://github.com/fridisbredis/sports-event-manager/actions',
            },
          ]}
          note={t('health.githubActions.note')}
        />
      </div>
    </div>
  )
}
