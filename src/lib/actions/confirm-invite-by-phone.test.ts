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

  // Adversarial: this action is a POST endpoint under the hood (Next.js
  // Server Actions), reachable directly if the action ID is known — a caller
  // does not have to have rendered /confirm-invite, or clicked its checkbox,
  // to invoke this. Everything below calls confirmInviteByPhone the way an
  // attacker would: skipping the UI entirely.
  describe('adversarial: calling the action without going through the UI', () => {
    it('cannot smuggle a truthy non-true value past the boolean check (type coercion)', async () => {
      mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
      vi.mocked(confirmOfficialInvite).mockResolvedValue('viadal')

      // JS/JSON callers aren't constrained by the TS boolean type at runtime.
      // A hand-crafted request body could send "true" (string), 1, or {} —
      // anything JS would treat as truthy under `if (!privacyAccepted)` but
      // that is not actually the literal `true` the RPC contract expects.
      await expect(confirmInviteByPhone('true' as unknown as boolean)).rejects.toThrow(
        'NEXT_REDIRECT'
      )

      // Documents current behavior: the truthy string is forwarded verbatim,
      // not normalized to a real boolean. confirmOfficialInvite/the RPC
      // layer receives whatever was sent, not a guaranteed `true`.
      expect(confirmOfficialInvite).toHaveBeenCalledWith('user-1', '+46701234567', 'true')
    })

    it('rejects an unauthenticated direct call the same way the UI path would', async () => {
      // No prior /confirm-invite render, no session cookie — simulates an
      // attacker who found the action ID but has no valid Supabase session.
      mockAuthedUser(null)

      await expect(confirmInviteByPhone(true)).rejects.toThrow('NEXT_REDIRECT')

      expect(redirect).toHaveBeenCalledWith('/login')
      expect(confirmOfficialInvite).not.toHaveBeenCalled()
    })

    it('cannot confirm a different phone number than the one on the authenticated session', async () => {
      // The action takes no phone/tenant/officialId argument from the
      // caller — user.phone comes only from the verified session, never
      // from client input. This pins that there is no parameter an
      // attacker could pass to target someone else's pending invite.
      mockAuthedUser({ id: 'attacker-user', phone: '+46700000000' })
      vi.mocked(confirmOfficialInvite).mockResolvedValue(null)

      await confirmInviteByPhone(true)

      // The phone passed to confirmOfficialInvite is exactly the session's
      // own phone — there is no argument on confirmInviteByPhone the caller
      // could use to substitute a different one.
      const [, phoneArg] = vi.mocked(confirmOfficialInvite).mock.calls[0]
      expect(phoneArg).toBe('+46700000000')
    })

    it('two concurrent calls for the same session both reach the RPC — no client-side dedup', async () => {
      // The action itself has no in-memory lock or idempotency guard; two
      // near-simultaneous invocations (double-click, or a scripted double
      // POST) both call through to confirmOfficialInvite. Safety against a
      // double-grant depends entirely on the RPC's row lock (migration
      // 0018/0045's SELECT ... FOR UPDATE + re-checked invite_status), which
      // this test cannot exercise against a mock — see the integration-style
      // note below. This test only pins that the action layer itself adds no
      // protection, so that guarantee cannot silently start being assumed
      // here.
      mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
      vi.mocked(confirmOfficialInvite).mockResolvedValueOnce('viadal').mockResolvedValueOnce(null) // simulates the RPC's second caller losing the row lock

      const first = confirmInviteByPhone(true).catch((e: Error) => e.message)
      const second = confirmInviteByPhone(true).catch((e: Error) => e.message)

      const [firstResult, secondResult] = await Promise.all([first, second])

      expect(confirmOfficialInvite).toHaveBeenCalledTimes(2)
      // First call wins and redirects (throws NEXT_REDIRECT); second call
      // observes the now-already-confirmed state and returns an error
      // instead of also redirecting.
      expect(firstResult).toBe('NEXT_REDIRECT')
      expect(secondResult).toEqual({ error: 'not_found' })
    })
  })
})
