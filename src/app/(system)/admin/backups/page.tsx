import { notFound } from 'next/navigation'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { listWeeklySlots } from '@/lib/backup/list-slots'
import { assessSlots, isoWeekOf, weekCoverage, type WeeklySlot } from '@/lib/backup/weekly-slots'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { StatusCard } from '../health/_components/status-card'

// N25 step 1 (SYS-04): which weekly prod backups exist to restore from.
//
// Read-only. It lists the four-week rotation through the list-only SAS token
// (it can see names and dates, never the dumps), and says plainly which weeks
// have no backup at all — the 2026-11-16 drill found two of four slots and
// nothing showed it. Restoring a tenant from here is steps 2 and 3 of N25;
// until they exist the note points at the manual path.

const OP = 'GET /admin/backups'

export default async function SystemBackupsPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')
  const now = new Date()
  const listing = await listWeeklySlots(OP)

  const statusLabels = {
    ok: t('backups.status.complete'),
    error: t('backups.status.missing'),
    unknown: t('backups.status.unavailable'),
  }
  // UTC on purpose: the rotation runs on ISO weeks in UTC, and the workflow
  // logs and blob metadata are UTC too, so an operator can match them up. No
  // year (the row's label has it) and no relative age (the newest-backup row
  // has it), and "UTC" said once in the note instead of on every row: the
  // value has to fit a phone without breaking mid-word.
  const absolute = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
  const describe = (slot: WeeklySlot) =>
    `${slot.name.replace(/^weekly-slot-(\d+)\.tar\.gz$/, 'slot $1')} · ${absolute.format(slot.capturedAt)}`

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <h1 className="page-title mb-2">{t('backups.title')}</h1>
      <p className="mb-6 max-w-[62ch] text-sm leading-relaxed text-ink-label">
        {t('backups.subtitle')}
      </p>

      <div className="flex max-w-3xl flex-col gap-4">
        {listing.status === 'ok' ? (
          coverageCards({ slots: listing.slots, now, t, statusLabels, describe })
        ) : (
          <StatusCard
            title={t('backups.weeksTitle')}
            status="unknown"
            statusLabels={statusLabels}
            note={
              listing.status === 'unconfigured'
                ? t('backups.unconfigured')
                : t('backups.listFailed')
            }
            links={[]}
          />
        )}
      </div>
    </div>
  )
}

// A plain function, not a component: the cards it returns become part of
// the page's own element tree, which is what page.test.tsx inspects.
function coverageCards({
  slots,
  now,
  t,
  statusLabels,
  describe,
}: {
  slots: WeeklySlot[]
  now: Date
  t: Awaited<ReturnType<typeof getServerTranslation>>
  statusLabels: Record<'ok' | 'error' | 'unknown', string>
  describe: (slot: WeeklySlot) => string
}) {
  const coverage = weekCoverage(slots, now)
  const { newestAgeDays, stale } = assessSlots(slots, now)
  const missing = coverage.weeks.filter((w) => w.slot === null)

  return (
    <>
      <StatusCard
        title={t('backups.weeksTitle')}
        status={missing.length > 0 ? 'error' : 'ok'}
        statusLabels={statusLabels}
        facts={[
          {
            label: t('backups.newestAge'),
            value:
              newestAgeDays === null
                ? t('backups.none')
                : t('backups.days', { count: newestAgeDays }),
            tone: stale ? 'error' : 'default',
          },
          ...coverage.weeks.map((w) => ({
            label: t('backups.week', { week: w.week, year: w.year }),
            value: w.slot ? describe(w.slot) : t('backups.weekMissing'),
            tone: w.slot ? ('default' as const) : ('error' as const),
          })),
        ]}
        note={`${
          missing.length > 0
            ? t('backups.missingNote', { count: missing.length })
            : t('backups.completeNote')
        } ${t('backups.timesUtc')}`}
        links={[]}
      />

      {coverage.older.length > 0 && (
        <StatusCard
          title={t('backups.olderTitle')}
          facts={coverage.older.map((slot) => ({
            label: t('backups.week', { ...isoWeekOf(slot.capturedAt) }),
            value: describe(slot),
          }))}
          note={`${t('backups.olderNote')} ${t('backups.timesUtc')}`}
          links={[]}
        />
      )}

      <StatusCard
        title={t('backups.restoreTitle')}
        note={t('backups.restoreNote')}
        links={[
          {
            label: t('backups.runbook'),
            href: 'https://github.com/fridisbredis/sports-event-manager/blob/main/docs/ops/backup-and-restore.md',
          },
          {
            label: t('backups.workflowRuns'),
            href: 'https://github.com/fridisbredis/sports-event-manager/actions/workflows/weekly-db-backup.yml',
          },
        ]}
      />
    </>
  )
}
