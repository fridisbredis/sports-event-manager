import { describe, it, expect, vi, beforeEach } from 'vitest'
import SchedulePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { ScheduleView } from './_components/schedule-view'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn().mockResolvedValue((key: string) => key),
}))

vi.mock('./_components/schedule-view', () => ({
  ScheduleView: vi.fn(() => null),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'order', 'limit', 'range']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function findByType(node: unknown, target: unknown): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object') return null
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (el.type === target) return el as { props: Record<string, unknown> }
  const children = el.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, target)
      if (found) return found
    }
  } else if (children) {
    return findByType(children, target)
  }
  return null
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null, fromMock: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)
}

function mockResolvedTenant(officialId: string | null = 'off-1') {
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
    officialId,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SchedulePage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(SchedulePage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(SchedulePage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('renders an empty assignments list when the user has no confirmed official row', async () => {
    // officialId is null: getOfficialTenant's access check (tenant_admin/
    // system_admin branch, or simply no confirmed row) found no officials row
    // to attach. The page must not query assignments at all in that case.
    mockResolvedTenant(null)
    const fromMock = vi.fn()
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS })

    expect(fromMock).not.toHaveBeenCalled()
    const view = findByType(result, ScheduleView)
    expect(view).not.toBeNull()
    expect(view!.props.assignments).toEqual([])
  })

  it('loads assignments scoped to the official and tenant when a confirmed official exists', async () => {
    // officialId comes straight from getOfficialTenant now — the page no
    // longer queries `officials` itself (F-PERF-07-style dedup with the
    // access check, which already ran this lookup under the service client).
    mockResolvedTenant('off-1')
    const assignments = [{ id: 'a-1', timeslot_start: '2026-08-12T09:00:00Z' }]
    const assignmentsBuilder = chain({ data: assignments })
    const fromMock = vi.fn().mockReturnValue(assignmentsBuilder)
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('assignments')
    expect(fromMock).not.toHaveBeenCalledWith('officials')
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('official_id', 'off-1')
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('status', 'assigned')

    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toEqual(assignments)
  })

  // Adversarial: nothing previously asserted that an assignments query error
  // actually propagates rather than being silently swallowed into an empty
  // list — which would be indistinguishable from "no assignments" to an
  // official checking their schedule on event day.
  it('throws when the assignments query errors, rather than rendering an empty schedule', async () => {
    mockResolvedTenant('off-1')
    const assignmentsBuilder = chain({ data: null, error: { message: 'boom' } })
    mockUser('user-1', vi.fn().mockReturnValue(assignmentsBuilder))

    await expect(SchedulePage({ params: PARAMS })).rejects.toEqual({ message: 'boom' })
  })

  // Adversarial: officialId must scope the assignments query even when the
  // tenant id and official id happen to collide in shape (both plausible
  // uuid-looking strings) — pins that official_id and tenant_id are always
  // two independent .eq() calls, not a single combined filter that could be
  // satisfied by either value alone.
  it('filters by both official_id and tenant_id independently, not by either alone', async () => {
    mockResolvedTenant('off-1')
    const assignmentsBuilder = chain({ data: [] })
    const fromMock = vi.fn().mockReturnValue(assignmentsBuilder)
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS })

    const eqCalls = (assignmentsBuilder.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(eqCalls).toContainEqual(['official_id', 'off-1'])
    expect(eqCalls).toContainEqual(['tenant_id', TENANT_ID])
    expect(eqCalls).toContainEqual(['status', 'assigned'])
    expect(eqCalls.length).toBe(3)
  })

  // Frida, PR #150: nothing in this file pinned the ceiling to the query.
  // `checkReadCeiling` is unit-tested in bounded-read.test.ts, but the wiring
  // on this page — the range argument, and the truncation of what actually
  // reaches ScheduleView — was covered only by the mock chain not crashing.
  it('bounds the read, asking for one row past the ceiling (PERF-06)', async () => {
    mockResolvedTenant('off-1')
    const assignmentsBuilder = chain({ data: [] })
    mockUser('user-1', vi.fn().mockReturnValue(assignmentsBuilder))

    await SchedulePage({ params: PARAMS })

    // 501 rows requested for a 500 ceiling: the extra row is what makes a
    // breach detectable instead of a silent truncation.
    expect(assignmentsBuilder.range).toHaveBeenCalledWith(0, 500)
  })

  it('warns and truncates to the ceiling when the ceiling is breached', async () => {
    mockResolvedTenant('off-1')
    const overflow = Array.from({ length: 501 }, (_, i) => ({
      id: `a-${i}`,
      timeslot_start: '2026-08-12T09:00:00Z',
    }))
    const assignmentsBuilder = chain({ data: overflow })
    mockUser('user-1', vi.fn().mockReturnValue(assignmentsBuilder))

    const result = await SchedulePage({ params: PARAMS })

    // The warn context is what makes a breach actionable in the logs — a
    // truncated schedule with no tenant/official attached is unchaseable.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('read ceiling'),
      expect.objectContaining({
        ceiling: 500,
        page: '(official)/schedule',
        tenantId: TENANT_ID,
        officialId: 'off-1',
      })
    )
    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toHaveLength(500)
  })

  it('does not warn when the row count sits exactly on the ceiling', async () => {
    mockResolvedTenant('off-1')
    const atCeiling = Array.from({ length: 500 }, (_, i) => ({
      id: `a-${i}`,
      timeslot_start: '2026-08-12T09:00:00Z',
    }))
    const assignmentsBuilder = chain({ data: atCeiling })
    mockUser('user-1', vi.fn().mockReturnValue(assignmentsBuilder))

    const result = await SchedulePage({ params: PARAMS })

    expect(logger.warn).not.toHaveBeenCalled()
    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toHaveLength(500)
  })
})
