import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemHealthPage from './page'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { notFound } from 'next/navigation'
import {
  fetchSupabaseStatus,
  fetchTwilioStatus,
  fetchSentryStatus,
  fetchGitHubActionsStatus,
} from './_lib/fetch-status'

vi.mock('@/lib/auth/tenant', () => ({
  requireSystemAdmin: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

// Partial mock: the probes are stubbed, but FAILED_CONCLUSIONS is a real
// value the page reads to tint failed rows — replacing it with a mock would
// break the page under test rather than isolate it.
vi.mock('./_lib/fetch-status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/fetch-status')>()),
  fetchSupabaseStatus: vi.fn(),
  fetchTwilioStatus: vi.fn(),
  fetchSentryStatus: vi.fn(),
  fetchGitHubActionsStatus: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
  vi.mocked(fetchSupabaseStatus).mockResolvedValue({ status: 'ok' })
  vi.mocked(fetchTwilioStatus).mockResolvedValue({ status: 'ok', sentToday: 0 })
  vi.mocked(fetchSentryStatus).mockResolvedValue({ status: 'ok', unresolvedCount: 0 })
  vi.mocked(fetchGitHubActionsStatus).mockResolvedValue({ status: 'ok', runs: [] })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co'
})

// The page returns an element tree, not DOM — these assertions read the props
// the page handed each card rather than rendering it, which is enough to catch
// a probe wired to the wrong card or a row built from the wrong field.
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

describe('SystemHealthPage', () => {
  it('calls notFound and does not probe anything when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(SystemHealthPage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
    expect(fetchSupabaseStatus).not.toHaveBeenCalled()
    expect(fetchTwilioStatus).not.toHaveBeenCalled()
    expect(fetchSentryStatus).not.toHaveBeenCalled()
    expect(fetchGitHubActionsStatus).not.toHaveBeenCalled()
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

    const sentryCard = findByTitle(result, 'Sentry')
    expect((sentryCard?.props as { status?: string })?.status).toBe('ok')
  })

  it('renders one row per deploy workflow, linked to the run', async () => {
    vi.mocked(fetchGitHubActionsStatus).mockResolvedValue({
      status: 'error',
      runs: [
        {
          workflow: 'deploy-dev.yml',
          conclusion: 'success',
          startedAt: new Date().toISOString(),
          url: 'https://github.com/run/dev',
        },
        {
          workflow: 'deploy-prod.yml',
          conclusion: 'failure',
          startedAt: new Date().toISOString(),
          url: 'https://github.com/run/prod',
        },
      ],
    })

    const card = findByTitle(await SystemHealthPage(), 'GitHub Actions')
    const props = card?.props as {
      status?: string
      facts?: { value: string; href?: string; tone?: string }[]
    }

    expect(props.status).toBe('error')
    expect(props.facts).toHaveLength(2)
    expect(props.facts?.[0].href).toBe('https://github.com/run/dev')
    // The failed row is the one tinted red, not the successful one.
    expect(props.facts?.[0].tone).toBe('default')
    expect(props.facts?.[1].tone).toBe('error')
  })

  it('shows no rows, rather than empty ones, when the probe could not reach GitHub', async () => {
    vi.mocked(fetchGitHubActionsStatus).mockResolvedValue({ status: 'unknown' })

    const card = findByTitle(await SystemHealthPage(), 'GitHub Actions')
    const props = card?.props as { status?: string; facts?: unknown }

    expect(props.status).toBe('unknown')
    expect(props.facts).toBeUndefined()
  })
})
