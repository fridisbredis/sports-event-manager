import { describe, it, expect, vi, beforeEach } from 'vitest'
import InvitePage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InviteForm from './_components/invite-form'

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
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null })
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
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null })
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
    expect(form!.props).toEqual({ token: TOKEN, phone: null, name: null })
  })

  it('renders InviteForm with the phone/name when the invite is valid and unexpired', async () => {
    const future = new Date(Date.now() + 100000).toISOString()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue(
        chain({
          data: {
            phone: '0701234567',
            name: 'Anna',
            invite_status: 'invited',
            invite_token_expires_at: future,
          },
        })
      ),
    } as never)

    const result = await InvitePage({ params: PARAMS })

    const form = findByType(result, InviteForm)
    expect(form!.props).toEqual({ token: TOKEN, phone: '0701234567', name: 'Anna' })
  })
})
