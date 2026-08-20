import { describe, it, expect, vi, beforeEach } from 'vitest'
import SchedulePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolveTenantForOfficial } from '@/lib/auth/tenant'
import { ScheduleView } from './_components/schedule-view'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  resolveTenantForOfficial: vi.fn(),
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
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: fromMock,
  } as never)
}

function mockResolvedTenant() {
  vi.mocked(resolveTenantForOfficial).mockResolvedValue({
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
    expect(resolveTenantForOfficial).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when resolveTenantForOfficial denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(resolveTenantForOfficial).mockResolvedValue(null)

    await expect(SchedulePage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(resolveTenantForOfficial).toHaveBeenCalledWith('viadal', 'user-1')
  })

  it('renders an empty assignments list when the user has no confirmed official row', async () => {
    mockResolvedTenant()
    mockUser('user-1', vi.fn().mockReturnValue(chain({ data: [] })))

    const result = await SchedulePage({ params: PARAMS })

    const view = findByType(result, ScheduleView)
    expect(view).not.toBeNull()
    expect(view!.props.assignments).toEqual([])
  })

  it('scopes the officials lookup by user_id, tenant_id, and confirmed status', async () => {
    mockResolvedTenant()
    const officialsBuilder = chain({ data: [] })
    const fromMock = vi.fn().mockReturnValue(officialsBuilder)
    mockUser('user-1', fromMock)

    await SchedulePage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('officials')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(officialsBuilder.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
  })

  it('loads assignments scoped to the official and tenant when a confirmed official exists', async () => {
    mockResolvedTenant()
    const officialsBuilder = chain({ data: [{ id: 'off-1' }] })
    const assignments = [{ id: 'a-1', timeslot_start: '2026-08-12T09:00:00Z' }]
    const assignmentsBuilder = chain({ data: assignments })
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(officialsBuilder).mockReturnValueOnce(assignmentsBuilder)
    mockUser('user-1', fromMock)

    const result = await SchedulePage({ params: PARAMS })

    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('official_id', 'off-1')
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(assignmentsBuilder.eq).toHaveBeenCalledWith('status', 'assigned')

    const view = findByType(result, ScheduleView)
    expect(view!.props.assignments).toEqual(assignments)
  })
})
