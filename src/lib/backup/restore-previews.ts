import { z } from 'zod'

import { logger } from '@/lib/logger'

// N25 step 2: the tenant restore previews that .github/workflows/
// restore-tenant-diff.yml writes, read for the system admin's Backups page.
//
// WHERE THEY LIVE. One blob per tenant, `preview-<tenant-id>.json`, in the
// private `restore-previews` container of the prod snapshot storage account,
// overwritten by the next run for that tenant. Not in GitHub: the repo is
// public, so a run summary or artifact there is readable by anyone.
//
// CREDENTIAL. RESTORE_PREVIEW_READ_URL is that container's URL with a SAS
// token carrying read + list on THAT container only. It cannot reach
// db-snapshots, where the full dumps are. The reports themselves hold counts
// and ids, never values (scripts/ops/diff-tenant.sh).

const OP = 'GET /admin/backups'

const csvWords = z
  .string()
  .default('')
  .transform((s) => s.split(/[\s,]+/).filter(Boolean))

const TableDiff = z.object({
  table: z.string(),
  log_or_queue: z.boolean().default(false),
  missing_in_live: z.boolean().optional(),
  no_primary_key: z.boolean().optional(),
  backup_rows: z.number(),
  live_rows: z.number().optional(),
  would_add: z.number().optional(),
  would_remove: z.number().optional(),
  would_change: z.number().optional(),
  changed_columns: z.record(z.string(), z.number()).default({}),
  columns_only_in_backup: csvWords,
  columns_only_in_live: csvWords,
})

export const RestorePreviewReport = z.object({
  tenant_id: z.string().uuid(),
  tenant_in_live: z.boolean(),
  generated_at: z.string(),
  slot: z.string().default(''),
  tables_new_in_live: csvWords,
  tables_out_of_scope: csvWords,
  inbound_foreign_keys: z
    .string()
    .default('')
    .transform((s) => s.split(', ').filter(Boolean)),
  tables: z.array(TableDiff),
  missing_users: z.array(
    z.object({ table: z.string(), column: z.string(), missing_users: z.number() })
  ),
})

export type RestorePreviewReport = z.infer<typeof RestorePreviewReport>
export type TableDiff = z.infer<typeof TableDiff>

export interface PreviewSummary {
  tenantId: string
  generatedAt: Date | null
  slot: string | null
  isoWeek: number | null
}

export type PreviewListing =
  | { status: 'ok'; previews: PreviewSummary[] }
  | { status: 'error' }
  | { status: 'unconfigured' }

const BLOB_NAME = /^preview-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return match ? match[1].trim() : null
}

/** Same hand-read of Azure's List Blobs XML as weekly-slots.ts parseBlobList. */
export function parsePreviewList(xml: string): PreviewSummary[] {
  const previews: PreviewSummary[] = []
  for (const [, block] of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
    const match = tag(block, 'Name')?.match(BLOB_NAME)
    if (!match) continue
    const generated = tag(block, 'generatedat') ?? tag(block, 'Last-Modified')
    const generatedAt = generated ? new Date(generated) : null
    previews.push({
      tenantId: match[1],
      generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null,
      slot: tag(block, 'slot'),
      isoWeek: /^\d+$/.test(tag(block, 'isoweek') ?? '') ? Number(tag(block, 'isoweek')) : null,
    })
  }
  return previews.sort((a, b) => (b.generatedAt?.getTime() ?? 0) - (a.generatedAt?.getTime() ?? 0))
}

function containerUrl(): URL | null {
  const base = process.env.RESTORE_PREVIEW_READ_URL
  return base ? new URL(base) : null
}

export async function listRestorePreviews(): Promise<PreviewListing> {
  const url = containerUrl()
  if (!url) return { status: 'unconfigured' }
  try {
    url.searchParams.set('restype', 'container')
    url.searchParams.set('comp', 'list')
    url.searchParams.set('prefix', 'preview-')
    url.searchParams.set('include', 'metadata')
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) {
      // Never log the URL: it carries the SAS signature.
      logger.error('Listing the restore previews failed', undefined, {
        op: OP,
        status: response.status,
      })
      return { status: 'error' }
    }
    return { status: 'ok', previews: parsePreviewList(await response.text()) }
  } catch (err) {
    logger.error('Listing the restore previews failed', err, { op: OP })
    return { status: 'error' }
  }
}

export type PreviewRead =
  | { status: 'ok'; report: RestorePreviewReport }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'unconfigured' }

export async function readRestorePreview(tenantId: string): Promise<PreviewRead> {
  const url = containerUrl()
  if (!url) return { status: 'unconfigured' }
  // The id becomes part of a URL path; only a uuid may.
  if (!z.string().uuid().safeParse(tenantId).success) return { status: 'not-found' }
  try {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/preview-${tenantId}.json`
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) {
      logger.error('Reading a restore preview failed', undefined, {
        op: OP,
        status: response.status,
      })
      return { status: 'error' }
    }
    const parsed = RestorePreviewReport.safeParse(await response.json())
    if (!parsed.success || parsed.data.tenant_id !== tenantId) {
      logger.error('A restore preview did not match the expected shape', undefined, {
        op: OP,
        issues: parsed.success ? 'tenant_id mismatch' : parsed.error.issues.slice(0, 5),
      })
      return { status: 'error' }
    }
    return { status: 'ok', report: parsed.data }
  } catch (err) {
    logger.error('Reading a restore preview failed', err, { op: OP })
    return { status: 'error' }
  }
}
