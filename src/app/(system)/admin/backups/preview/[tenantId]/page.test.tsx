import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import RestorePreviewPage from './page'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { readRestorePreview, RestorePreviewReport } from '@/lib/backup/restore-previews'
import { notFound } from 'next/navigation'

const TENANT = '354fbfd8-e8ea-4853-a3cd-88ecda3aa154'

vi.mock('@/lib/auth/tenant', () => ({ requireSystemAdmin: vi.fn() }))

vi.mock('@/lib/backup/restore-previews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/backup/restore-previews')>()),
  readRestorePreview: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: 'Micke testar' } }) }),
      }),
    }),
  })),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

// The shape diff-tenant.sh writes, from the first real run (micke-testar, slot 3).
const report = RestorePreviewReport.parse({
  tenant_id: TENANT,
  tenant_in_live: true,
  generated_at: '2026-11-24T13:57:12Z',
  slot: '3 (ISO week 47, captured 2026-11-22T11:38:32Z)',
  tables_new_in_live: 'admin_guide_dismissals',
  tables_out_of_scope: 'push_subscriptions rate_limit_hits user_ice_contacts user_preferences',
  inbound_foreign_keys: '',
  tables: [
    {
      table: 'announcements',
      backup_rows: 1,
      live_rows: 2,
      would_add: 0,
      would_remove: 1,
      would_change: 0,
    },
    {
      table: 'assignments',
      backup_rows: 36,
      live_rows: 35,
      would_add: 1,
      would_remove: 0,
      would_change: 0,
    },
    {
      table: 'officials',
      backup_rows: 3,
      live_rows: 3,
      would_add: 0,
      would_remove: 0,
      would_change: 1,
      changed_columns: { name: 1 },
    },
    {
      table: 'sms_queue',
      log_or_queue: true,
      backup_rows: 0,
      live_rows: 2,
      would_add: 0,
      would_remove: 2,
      would_change: 0,
    },
    {
      table: 'events',
      backup_rows: 1,
      live_rows: 1,
      would_add: 0,
      would_remove: 0,
      would_change: 0,
    },
  ],
  missing_users: [],
})

const params = Promise.resolve({ tenantId: TENANT })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(readRestorePreview).mockResolvedValue({ status: 'ok', report })
})

describe('RestorePreviewPage', () => {
  it('calls notFound and reads nothing when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(RestorePreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(readRestorePreview).not.toHaveBeenCalled()
  })

  it('is notFound when the tenant has no preview', async () => {
    vi.mocked(readRestorePreview).mockResolvedValue({ status: 'not-found' })

    await expect(RestorePreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('lists the tables a restore would change, with their counts and columns', async () => {
    render(await RestorePreviewPage({ params }))

    expect(screen.getByRole('heading', { name: 'Restore preview: Micke testar' })).toBeTruthy()
    const changedCard = screen.getByRole('heading', {
      name: '3 tables would change',
    }).parentElement!
    const items = within(changedCard)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('announcements')
    expect(items[0]).toContain('−1')
    expect(items.find((i) => i?.startsWith('officials'))).toContain('name (1)')
    expect(items.some((i) => i?.startsWith('sms_queue'))).toBe(false)
    expect(screen.getByText('1 table unchanged')).toBeTruthy()
  })

  it('shows keep-live tables apart, as kept rather than changed', async () => {
    render(await RestorePreviewPage({ params }))

    // sms_queue is marked the pre-2026-11-24 way (log_or_queue), as in the
    // report already stored in prod.
    const keptCard = screen.getByRole('heading', { name: '1 table kept as in live' }).parentElement!
    expect(within(keptCard).getByText('sms_queue')).toBeTruthy()
    expect(within(keptCard).getByText(/never restored/)).toBeTruthy()
  })

  it('warns about tables created since the backup and unclassified ones', async () => {
    vi.mocked(readRestorePreview).mockResolvedValue({
      status: 'ok',
      report: { ...report, tables_unclassified: ['new_event_log'] },
    })

    render(await RestorePreviewPage({ params }))

    expect(screen.getByText(/Tables created since the backup.*admin_guide_dismissals/)).toBeTruthy()
    expect(screen.getByText(/Not classified for restore: new_event_log/)).toBeTruthy()
  })

  it('says so when the tenant was deleted after the backup', async () => {
    vi.mocked(readRestorePreview).mockResolvedValue({
      status: 'ok',
      report: { ...report, tenant_in_live: false },
    })

    render(await RestorePreviewPage({ params }))

    expect(screen.getByText(/no longer exists in live prod/)).toBeTruthy()
  })

  it('shows an error instead of a report it could not read', async () => {
    vi.mocked(readRestorePreview).mockResolvedValue({ status: 'error' })

    render(await RestorePreviewPage({ params }))

    expect(screen.getByText(/could not be read/)).toBeTruthy()
  })
})
