import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirmInviteByPhone } from './confirm-invite-by-phone'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { confirmOfficialInvite } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  confirmOfficialInvite: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

function mockAuthedUser(user: { id: string; phone?: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('confirmInviteByPhone', () => {
  it('returns an error and never reaches auth when privacyAccepted is false', async () => {
    const result = await confirmInviteByPhone(false)

    expect(result).toEqual({ error: 'privacy_not_accepted' })
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
    expect(confirmOfficialInvite).not.toHaveBeenCalled()
  })

  it('redirects to /login when there is no authenticated user', async () => {
    mockAuthedUser(null)

    await expect(confirmInviteByPhone(true)).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/login')
    expect(confirmOfficialInvite).not.toHaveBeenCalled()
  })

  it('returns phone_mismatch when the authenticated user has no verified phone', async () => {
    mockAuthedUser({ id: 'user-1' })

    const result = await confirmInviteByPhone(true)

    expect(result).toEqual({ error: 'phone_mismatch' })
    expect(confirmOfficialInvite).not.toHaveBeenCalled()
  })

  it('returns not_found when confirmOfficialInvite finds no matching invite', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(confirmOfficialInvite).mockResolvedValue(null)

    const result = await confirmInviteByPhone(true)

    expect(result).toEqual({ error: 'not_found' })
  })

  it('redirects to the tenant assignments page on success, passing consent through', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(confirmOfficialInvite).mockResolvedValue('viadal')

    await expect(confirmInviteByPhone(true)).rejects.toThrow('NEXT_REDIRECT')

    expect(confirmOfficialInvite).toHaveBeenCalledWith('user-1', '+46701234567', true)
    expect(redirect).toHaveBeenCalledWith('/viadal/assignments')
  })
})
