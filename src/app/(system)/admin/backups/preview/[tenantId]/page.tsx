import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppCard } from '@/components/ui/app-card'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { readRestorePreview, type TableDiff } from '@/lib/backup/restore-previews'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { relativeTime } from '../../../health/_lib/relative-time'

// N25 step 2: one tenant's restore preview — what restoring it from a weekly
// backup would do to live prod, as written by restore-tenant-diff.yml. Counts,
// ids and column names only; the report never holds values.

interface Props {
  params: Promise<{ tenantId: string }>
}

const differs = (d: TableDiff) =>
  Boolean(d.missing_in_live || d.would_add || d.would_remove || d.would_change)

export default async function RestorePreviewPage({ params }: Props) {
  const { tenantId } = await params

  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')
  const supabase = await createSupabaseServerClient()

  const [read, tenantResult] = await Promise.all([
    readRestorePreview(tenantId),
    supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
  ])
  if (read.status === 'not-found' || read.status === 'unconfigured') notFound()

  const name = tenantResult.data?.name ?? tenantId

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <Link
        href="/admin/backups"
        className="text-sm text-ink-label underline decoration-edge-field underline-offset-4 hover:text-ink"
      >
        ← {t('backups.preview.back')}
      </Link>
      <h1 className="page-title mb-2 mt-3">{t('backups.preview.title', { name })}</h1>

      {read.status === 'error' ? (
        <p className="max-w-[62ch] text-sm leading-relaxed text-destructive">
          {t('backups.preview.readFailed')}
        </p>
      ) : (
        <PreviewBody report={read.report} t={t} language={language} />
      )}
    </div>
  )
}

function PreviewBody({
  report,
  t,
  language,
}: {
  report: Extract<Awaited<ReturnType<typeof readRestorePreview>>, { status: 'ok' }>['report']
  t: Awaited<ReturnType<typeof getServerTranslation>>
  language: string
}) {
  // keep-live tables are never restored (supabase/tenant-restore-tables.txt),
  // so their differences are shown apart: they are what stays, not what changes.
  const changed = report.tables.filter((d) => differs(d) && !d.keep_live)
  const kept = report.tables.filter((d) => differs(d) && d.keep_live)
  const unchanged = report.tables.filter((d) => !differs(d))
  const drift = report.tables.filter(
    (d) => d.columns_only_in_live.length > 0 || d.columns_only_in_backup.length > 0
  )
  const when = relativeTime(report.generated_at, language)

  return (
    <>
      <p className="mb-6 max-w-[62ch] text-sm leading-relaxed text-ink-label">
        {t('backups.preview.subtitle', {
          slot: report.slot || '?',
          when: when ?? report.generated_at,
        })}
      </p>

      <div className="flex max-w-3xl flex-col gap-4">
        {!report.tenant_in_live && <Notice tone="error">{t('backups.preview.tenantGone')}</Notice>}

        <AppCard>
          <h3 className="font-display text-base font-bold tracking-tight text-ink">
            {changed.length === 0
              ? t('backups.preview.noChanges')
              : t('backups.preview.changedTitle', { count: changed.length })}
          </h3>
          {changed.length > 0 && <DiffList tables={changed} t={t} />}
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            {t('backups.preview.legend')}
          </p>
        </AppCard>

        {report.tables_unclassified.length > 0 && (
          <Notice tone="error">
            {t('backups.preview.unclassified', { list: report.tables_unclassified.join(', ') })}
          </Notice>
        )}

        {kept.length > 0 && (
          <AppCard>
            <h3 className="font-display text-base font-bold tracking-tight text-ink">
              {t('backups.preview.keptTitle', { count: kept.length })}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-label">
              {t('backups.preview.keptNote')}
            </p>
            <DiffList tables={kept} t={t} muted />
          </AppCard>
        )}

        {report.missing_users.length > 0 && (
          <Notice tone="warning">
            {t('backups.preview.missingUsers', {
              list: report.missing_users
                .map((m) => `${m.table}.${m.column} (${m.missing_users})`)
                .join(', '),
            })}
          </Notice>
        )}

        {report.tables_new_in_live.length > 0 && (
          <Notice tone="warning">
            {t('backups.preview.newTables', { list: report.tables_new_in_live.join(', ') })}
          </Notice>
        )}

        {drift.length > 0 && (
          <Notice tone="warning">
            {t('backups.preview.drift', {
              list: drift
                .map((d) =>
                  [
                    ...d.columns_only_in_live.map((c) => `+${d.table}.${c}`),
                    ...d.columns_only_in_backup.map((c) => `−${d.table}.${c}`),
                  ].join(', ')
                )
                .join(', '),
            })}
          </Notice>
        )}

        {report.inbound_foreign_keys.length > 0 && (
          <Notice tone="warning">
            {t('backups.preview.inbound', { list: report.inbound_foreign_keys.join(', ') })}
          </Notice>
        )}

        <AppCard>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {t('backups.preview.unchangedTitle', { count: unchanged.length })}
            </summary>
            <p className="mt-3 font-mono text-xs leading-relaxed text-ink-label">
              {unchanged.map((d) => d.table).join(', ')}
            </p>
          </details>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            {t('backups.preview.outOfScope', { list: report.tables_out_of_scope.join(', ') })}
          </p>
        </AppCard>

        <p className="text-xs leading-relaxed text-ink-faint">
          {t('backups.preview.nothingWritten')}
        </p>
      </div>
    </>
  )
}

function DiffList({
  tables,
  t,
  muted = false,
}: {
  tables: TableDiff[]
  t: Awaited<ReturnType<typeof getServerTranslation>>
  /** Kept-live tables: shown for information, so they do not read as changes. */
  muted?: boolean
}) {
  return (
    <ul className="mt-4 divide-y divide-edge-soft">
      {tables.map((d) => (
        <li key={d.table} className="py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className={`font-mono text-sm font-medium ${muted ? 'text-ink-label' : 'text-ink'}`}>
              {d.table}
            </p>
            {d.missing_in_live ? (
              <p className="text-sm text-destructive">{t('backups.preview.goneFromLive')}</p>
            ) : (
              <p className={`flex gap-3 font-mono text-sm ${muted ? 'opacity-60' : ''}`}>
                <Count n={d.would_add} sign="+" label={t('backups.preview.add')} />
                <Count n={d.would_remove} sign="−" label={t('backups.preview.remove')} />
                <Count n={d.would_change} sign="~" label={t('backups.preview.change')} />
              </p>
            )}
          </div>
          {Object.keys(d.changed_columns).length > 0 && (
            <p className="mt-1 text-xs text-ink-label">
              {t('backups.preview.columns')}{' '}
              {Object.entries(d.changed_columns)
                .map(([col, n]) => `${col} (${n})`)
                .join(', ')}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function Count({ n, sign, label }: { n?: number; sign: string; label: string }) {
  return (
    <span title={label} className={n ? 'text-ink' : 'text-ink-faint'}>
      <span className="sr-only">{label} </span>
      {sign}
      {n ?? 0}
    </span>
  )
}

// Same notice treatment as the privacy page's (pending tint) for warnings, so
// "read this before restoring" looks like it does elsewhere in the app.
function Notice({ tone, children }: { tone: 'warning' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-card border-1 px-5 py-4 text-sm leading-relaxed ${
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-status-pending-text/20 bg-status-pending-bg/60 text-ink'
      }`}
    >
      {children}
    </div>
  )
}
