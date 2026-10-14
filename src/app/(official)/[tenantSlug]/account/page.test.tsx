import { describe, it, expect, vi, beforeEach } from 'vitest'
import OfficialAccountPage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import AccountForm from './_components/account-form'

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

vi.mock('./_components/account-form', () => ({
  default: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.not = vi.fn(() => builder)
  builder.range = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
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

/**
 * An ISO instant at `hhmm` today. Derived rather than written as a literal:
 * `countShifts` groups by UTC day, so a hardcoded date would start failing
 * the moment the clock passed it.
 */
function slot(hhmm: string): string {
  return `${new Date().toISOString().slice(0, 10)}T${hhmm}:00.000Z`
}
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
    tier: 'professional',
    is_active: true,
    officialId: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialAccountPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = vi.fn()
    mockUser(null, fromMock)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getOfficialTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    const fromMock = vi.fn()
    mockUser('user-1', fromMock)
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('calls notFound when no official row matches this user and tenant', async () => {
    mockResolvedTenant()
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(chain({ data: null })) // officials
    mockUser('user-1', fromMock)

    await expect(OfficialAccountPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('scopes the officials lookup by user_id and tenant_id', async () => {
    mockResolvedTenant()
    const officialsBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: false },
    })
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(officialsBuilder).mockReturnValueOnce(chain({ data: [] }))
    mockUser('user-1', fromMock)

    await OfficialAccountPage({ params: PARAMS })

    expect(officialsBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('renders AccountForm with the official row and shift count', async () => {
    mockResolvedTenant()
    const official = { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: true }
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(chain({ data: official })).mockReturnValueOnce(
      // Four hourly slots: three back-to-back at one work area, one later at
      // another. Two shifts — the number MYSCH-01 draws two cards for, and
      // the regression this screen's head count got wrong by reporting 4.
      chain({
        data: [
          { timeslot_start: slot('11:00'), timeslot_end: slot('12:00'), workstation_id: 'ws-1' },
          { timeslot_start: slot('12:00'), timeslot_end: slot('13:00'), workstation_id: 'ws-1' },
          { timeslot_start: slot('13:00'), timeslot_end: slot('14:00'), workstation_id: 'ws-1' },
          { timeslot_start: slot('16:00'), timeslot_end: slot('17:00'), workstation_id: 'ws-2' },
        ],
      })
    )
    mockUser('user-1', fromMock)

    const result = await OfficialAccountPage({ params: PARAMS })

    const form = findByType(result, AccountForm)
    expect(form).not.toBeNull()
    expect(form!.props).toEqual({
      name: 'Anna',
      phone: '0701234567',
      smsOptOut: true,
      tenantId: TENANT_ID,
      tenantSlug: 'viadal',
      shiftCount: 2,
      i18nNamespace: 'official',
      language: 'en',
      avatarUrl: undefined,
    })
  })

  it('shows 0 shifts when the count read fails', async () => {
    mockResolvedTenant()
    const official = { id: 'off-1', name: 'Anna', phone: '0701234567', sms_opt_out: false }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: official }))
      // Degraded rather than fatal: the summary line is not worth failing the
      // whole account screen over.
      .mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    mockUser('user-1', fromMock)

    const result = await OfficialAccountPage({ params: PARAMS })

    const form = findByType(result, AccountForm)
    expect(form!.props.shiftCount).toBe(0)
  })
})
