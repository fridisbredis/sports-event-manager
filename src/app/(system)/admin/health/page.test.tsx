import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemHealthPage from './page'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { notFound } from 'next/navigation'
import { fetchSupabaseStatus, fetchTwilioStatus, fetchSentryStatus } from './_lib/fetch-status'

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
  fetchSentryStatus: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(fetchSupabaseStatus).mockResolvedValue({ status: 'ok' })
  vi.mocked(fetchTwilioStatus).mockResolvedValue({ status: 'ok', sentToday: 0 })
  vi.mocked(fetchSentryStatus).mockResolvedValue({ status: 'ok', unresolvedCount: 0 })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
})

describe('SystemHealthPage', () => {
  it('calls notFound and does not probe anything when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(SystemHealthPage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
    expect(fetchSupabaseStatus).not.toHaveBeenCalled()
    expect(fetchTwilioStatus).not.toHaveBeenCalled()
    expect(fetchSentryStatus).not.toHaveBeenCalled()
  })

  it('renders once the caller is a system admin', async () => {
    const result = await SystemHealthPage()

    expect(result).toBeTruthy()
    expect(fetchSupabaseStatus).toHaveBeenCalled()
    expect(fetchTwilioStatus).toHaveBeenCalled()
    expect(fetchSentryStatus).toHaveBeenCalled()
  })

  it('shows the Sentry card as ok when the probe succeeds, even with unresolved issues', async () => {
    vi.mocked(fetchSentryStatus).mockResolvedValue({ status: 'ok', unresolvedCount: 3 })

    const result = await SystemHealthPage()

    function findByTitle(node: unknown, title: string): React.ReactElement | undefined {
      if (!node || typeof node !== 'object') return undefined
      const el = node as React.ReactElement<{ title?: string; children?: unknown }>
      if (el.props?.title === title) return el
      const children = el.props?.children
      if (Array.isArray(children)) {
        for (const child of children) {
          const found = findByTitle(child, title)
          if (found) return found
        }
      } else if (children) {
        return findByTitle(children, title)
      }
      return undefined
    }

    const sentryCard = findByTitle(result, 'Sentry')
    expect((sentryCard?.props as { status?: string })?.status).toBe('ok')
  })
})
