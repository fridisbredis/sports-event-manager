import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemHealthPage from './page'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { notFound } from 'next/navigation'
import { fetchSupabaseStatus, fetchTwilioStatus } from './_lib/fetch-status'

vi.mock('@/lib/auth/tenant', () => ({
  requireSystemAdmin: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('./_lib/fetch-status', () => ({
  fetchSupabaseStatus: vi.fn(),
  fetchTwilioStatus: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(fetchSupabaseStatus).mockResolvedValue({ status: 'ok' })
  vi.mocked(fetchTwilioStatus).mockResolvedValue({ status: 'ok', sentToday: 0 })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
})

describe('SystemHealthPage', () => {
  it('calls notFound and does not probe anything when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(SystemHealthPage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
    expect(fetchSupabaseStatus).not.toHaveBeenCalled()
    expect(fetchTwilioStatus).not.toHaveBeenCalled()
  })

  it('renders once the caller is a system admin', async () => {
    const result = await SystemHealthPage()

    expect(result).toBeTruthy()
    expect(fetchSupabaseStatus).toHaveBeenCalled()
    expect(fetchTwilioStatus).toHaveBeenCalled()
  })
})
