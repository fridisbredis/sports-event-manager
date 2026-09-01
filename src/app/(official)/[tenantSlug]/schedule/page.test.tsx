import { describe, it, expect, vi, beforeEach } from 'vitest'
import SchedulePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant, getConfirmedOfficial } from '@/lib/auth/tenant'
import { ScheduleView } from './_components/schedule-view'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
  getConfirmedOfficial: vi.fn(),
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

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
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

function mockResolvedTenant() {
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
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
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: [] })))
    vi.mocked(getConfirmedOfficial).mockResolvedValue(null)

    const result = await SchedulePage({ params: PARAMS })

    const view = findByType(result, ScheduleView)
    expect(view).not.toBeNull()
    expect(view!.props.assignments).toEqual([])
  })

  // The officials lookup itself moved into getConfirmedOfficial so the access
  // check and this page share one query (PERF-01). Its filters are asserted in
  // tenant.test.ts; what matters here is that the page asks for the right
  // (user, tenant) pair and does not re-query the table itself.
  it('resolves the confirmed official through the shared memoised helper', async () => {
    mockResolvedTenant()
    const fromMock = vi.fn().mockReturnValue(chain({ data: [] }))
    mockUser('user-1', fromMock)
    vi.mocked(getConfirmedOfficial).mockResolvedValue(null)

    await SchedulePage({ params: PARAMS })

    expect(getConfirmedOfficial).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalledWith('officials')
  })

  it('loads assignments scoped to the official and tenant when a confirmed official exists', async () => {
    mockResolvedTenant()
    const assignments = [{ id: 'a-1', timeslot_start: '2026-08-12T09:00:00Z' }]
    const assignmentsBuilder = chain({ data: assignments })
    const fromMock = vi.fn().mockReturnValue(assignmentsBuilder)
    mockUser('user-1', fromMock)
    vi.mocked(getConfirmedOfficial).mockResolvedValue({ id: 'off-1' })

    const result = await SchedulePage({ params: PARAMS })

    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('official_id', 'off-1')
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('status', 'assigned')

    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toEqual(assignments)
  })
})
