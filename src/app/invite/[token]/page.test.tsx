import { describe, it, expect, vi, beforeEach } from 'vitest'
import InvitePage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InviteForm from './_components/invite-form'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'
import { DEFAULT_TENANT_PALETTE } from '@/lib/theme/tenant-colors'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('./_components/invite-form', () => ({
  default: vi.fn(() => null),
}))

// TenantThemeStyle renders a raw <style> tag; effectivePalette stays real
// because the tier gate is what these tests assert on.
vi.mock('@/lib/theme/tenant-theme-style', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/theme/tenant-theme-style')>()),
  TenantThemeStyle: vi.fn(() => null),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
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

const TOKEN = 'abc-123'
const PARAMS = Promise.resolve({ token: TOKEN })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InvitePage', () => {
  it('looks up the official by invite_token, not by any other field', async () => {
    const officialsBuilder = chain({ data: null })
    const fromMock = vi.fn().mockReturnValue(officialsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await InvitePage({ params: PARAMS })

    expect(fromMock).toHaveBeenCalledWith('officials')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('invite_token', TOKEN)
  })

  it('redirects to /login when the invite is already confirmed', async () => {
    const officialsBuilder = chain({ data: { invite_status: 'confirmed' } })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(officialsBuilder),
    } as never)

    await expect(InvitePage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('renders InviteForm with null phone/name when no official matches the token', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(chain({ data: null })),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    // tenantName null as well: an expired or unknown token must not be usable
    // to probe which organisation the link belonged to.
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null, tenantName: null })
  })

  it('renders InviteForm with null phone/name when the invite token has expired', async () => {
    const expired = new Date(Date.now() - 1000).toISOString()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: expired,
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    // tenantName null as well: an expired or unknown token must not be usable
    // to probe which organisation the link belonged to.
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null, tenantName: null })
  })

  it('renders InviteForm with null phone/name when invite_status is not "invited"', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'removed',
            invite_token_expires_at: new Date(Date.now() + 100000).toISOString(),
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    // tenantName null as well: an expired or unknown token must not be usable
    // to probe which organisation the link belonged to.
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null, tenantName: null })
  })

  // This page reads the palette straight off the joined tenant row rather than
  // through ResolvedTenant, so it needs its own tier gating — without it an
  // invite into a locked tenant would paint a theme the tenant may not use.
  it('paints the default palette when the tenant tier excludes the theme', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: new Date(Date.now() + 100000).toISOString(),
            tenants: { color_palette: 'purple', tier: 'standard' },
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe(DEFAULT_TENANT_PALETTE)
  })

  it('paints the stored palette when the tenant tier includes the theme', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: new Date(Date.now() + 100000).toISOString(),
            tenants: { color_palette: 'purple', tier: 'premium' },
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const style = findByType(result, TenantThemeStyle)
    expect(style!.props.colorPalette).toBe('purple')
  })

  // An expired or unknown token must stay unthemed: the colour would reveal
  // which organisation the link belonged to.
  it('renders no theme at all for an invalid invite', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: new Date(Date.now() - 100000).toISOString(),
            tenants: { color_palette: 'purple', tier: 'premium' },
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    expect(findByType(result, TenantThemeStyle)).toBeNull()
  })

  it('renders InviteForm with the phone/name and organizer when the invite is valid and unexpired', async () => {
    const future = new Date(Date.now() + 100000).toISOString()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: future,
            tenants: { name: 'Viadal 2026', color_palette: 'blue', tier: 'professional' },
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    // The name is what lets the landing page say who is inviting (N19) — the
    // SMS named the organiser and the page did not.
    expect(form!.props).toEqual({
      token: TOKEN,
      phone: '0701234567',
      name: 'Anna',
      tenantName: 'Viadal 2026',
    })
  })

  // The join can come back without a tenant row (a failed or filtered read).
  // The form degrades to unnamed copy, so the page must pass null rather than
  // let `undefined` through and render a gap where the name should be.
  it('passes a null organizer when the tenant row is missing from the join', async () => {
    const future = new Date(Date.now() + 100000).toISOString()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: future,
            tenants: null,
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    expect(form!.props).toEqual({
      token: TOKEN,
      phone: '0701234567',
      name: 'Anna',
      tenantName: null,
    })
  })
})
