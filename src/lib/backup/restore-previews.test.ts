import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { listRestorePreviews, parsePreviewList, readRestorePreview } from './restore-previews'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))

const TENANT = '354fbfd8-e8ea-4853-a3cd-88ecda3aa154'
const BASE = 'https://acct.blob.core.windows.net/restore-previews?sv=2024&sp=rl&sig=SECRET'

function blob(name: string, meta: Record<string, string> = {}) {
  const m = Object.entries(meta)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')
  return `<Blob><Name>${name}</Name><Properties><Last-Modified>Tue, 24 Nov 2026 13:58:00 GMT</Last-Modified></Properties><Metadata>${m}</Metadata></Blob>`
}
const listXml = (...blobs: string[]) =>
  `<?xml version="1.0"?><EnumerationResults><Blobs>${blobs.join('')}</Blobs></EnumerationResults>`

function report(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT,
    tenant_in_live: true,
    generated_at: '2026-11-24T13:57:12Z',
    slot: '3 (ISO week 47, captured 2026-11-22T11:38:32Z)',
    tables_new_in_live: 'admin_guide_dismissals',
    tables_out_of_scope: 'push_subscriptions rate_limit_hits',
    inbound_foreign_keys: '',
    tables: [
      {
        table: 'announcements',
        keep_live: false,
        backup_rows: 1,
        live_rows: 2,
        would_add: 0,
        would_remove: 1,
        would_change: 0,
        changed_columns: {},
        sample_add: [],
        sample_remove: ['a1'],
        sample_change: [],
        columns_only_in_backup: '',
        columns_only_in_live: 'new_col',
      },
    ],
    missing_users: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('RESTORE_PREVIEW_READ_URL', BASE)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('parsePreviewList', () => {
  it('reads tenant, slot, week and time from each preview blob, newest first', () => {
    const other = '27814a31-6bc9-47a4-98b2-eee538c7a7d0'
    const previews = parsePreviewList(
      listXml(
        blob(`preview-${other}.json`, {
          slot: '0',
          isoweek: '44',
          generatedat: '2026-11-02T10:00:00Z',
        }),
        blob(`preview-${TENANT}.json`, {
          slot: '3',
          isoweek: '47',
          generatedat: '2026-11-24T13:58:00Z',
        })
      )
    )

    expect(previews).toEqual([
      { tenantId: TENANT, slot: '3', isoWeek: 47, generatedAt: new Date('2026-11-24T13:58:00Z') },
      { tenantId: other, slot: '0', isoWeek: 44, generatedAt: new Date('2026-11-02T10:00:00Z') },
    ])
  })

  it('ignores blobs that are not previews', () => {
    expect(parsePreviewList(listXml(blob('notes.txt'), blob('preview-not-a-uuid.json')))).toEqual(
      []
    )
  })
})

describe('listRestorePreviews', () => {
  it('lists the container with metadata, keeping the SAS query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(listXml()))
    vi.stubGlobal('fetch', fetchMock)

    expect(await listRestorePreviews()).toEqual({ status: 'ok', previews: [] })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('sig')).toBe('SECRET')
    expect(url.searchParams.get('comp')).toBe('list')
    expect(url.searchParams.get('include')).toBe('metadata')
  })

  it('is unconfigured without the URL', async () => {
    vi.stubEnv('RESTORE_PREVIEW_READ_URL', '')
    expect(await listRestorePreviews()).toEqual({ status: 'unconfigured' })
  })

  it('reports a rejected token as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
    expect(await listRestorePreviews()).toEqual({ status: 'error' })
  })
})

describe('readRestorePreview', () => {
  it("reads the tenant's blob from the container, keeping the SAS query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(report()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await readRestorePreview(TENANT)

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe(`/restore-previews/preview-${TENANT}.json`)
    expect(url.searchParams.get('sig')).toBe('SECRET')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.report.tables_new_in_live).toEqual(['admin_guide_dismissals'])
    expect(result.report.tables[0]).toMatchObject({
      table: 'announcements',
      would_remove: 1,
      columns_only_in_live: ['new_col'],
      columns_only_in_backup: [],
    })
    expect(result.report.inbound_foreign_keys).toEqual([])
    expect(result.report.tables_unclassified).toEqual([])
  })

  it('reads keep_live, and log_or_queue from reports written before the classification file', async () => {
    const tables = [
      { table: 'sms_queue', log_or_queue: true, backup_rows: 0 },
      { table: 'auth_events', keep_live: true, backup_rows: 0 },
      { table: 'events', backup_rows: 1 },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(report({ tables }))))

    const result = await readRestorePreview(TENANT)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.report.tables.map((t) => [t.table, t.keep_live])).toEqual([
      ['sms_queue', true],
      ['auth_events', true],
      ['events', false],
    ])
  })

  it('never builds a URL from something that is not a uuid', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await readRestorePreview('../db-snapshots/weekly-slot-0.tar.gz')).toEqual({
      status: 'not-found',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is not-found when the tenant has no preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    expect(await readRestorePreview(TENANT)).toEqual({ status: 'not-found' })
  })

  it('rejects a report for another tenant', async () => {
    const other = report({ tenant_id: '27814a31-6bc9-47a4-98b2-eee538c7a7d0' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(other)))
    expect(await readRestorePreview(TENANT)).toEqual({ status: 'error' })
  })

  it('rejects a report of the wrong shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ tenant_id: TENANT })))
    expect(await readRestorePreview(TENANT)).toEqual({ status: 'error' })
  })
})
