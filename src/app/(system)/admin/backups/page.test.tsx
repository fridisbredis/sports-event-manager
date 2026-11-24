import type React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SystemBackupsPage from './page'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { listWeeklySlots } from '@/lib/backup/list-slots'
import { notFound } from 'next/navigation'

vi.mock('@/lib/auth/tenant', () => ({
  requireSystemAdmin: vi.fn(),
}))

vi.mock('@/lib/backup/list-slots', () => ({
  listWeeklySlots: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

type Fact = { label: string; value: string; tone?: string }
type CardProps = { title?: string; status?: string; facts?: Fact[]; note?: string }

// Same approach as the health page test: read the props each card was given
// from the returned element tree instead of rendering it.
function findByTitle(node: unknown, title: string): CardProps | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTitle(child, title)
      if (found) return found
    }
    return undefined
  }
  const el = node as React.ReactElement<CardProps & { children?: unknown }>
  if (el.props?.title === title) return el.props
  return findByTitle(el.props?.children, title)
}

const slot = (name: string, iso: string, isoWeek: number) => ({
  name,
  capturedAt: new Date(iso),
  isoWeek,
})

beforeEach(() => {
  vi.clearAllMocks()
  // Only Date: faking timers too stalls the translation loader the page awaits.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.mocked(requireSystemAdmin).mockResolvedValue({ user: { id: 'user-1' } } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SystemBackupsPage', () => {
  it('calls notFound and lists nothing when the caller is not a system admin', async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({ error: {} } as never)

    await expect(SystemBackupsPage()).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
    expect(listWeeklySlots).not.toHaveBeenCalled()
  })

  it('names the missing weeks in the state the 2026-11 drill found', async () => {
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
    vi.mocked(listWeeklySlots).mockResolvedValue({
      status: 'ok',
      slots: [
        slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z', 44),
        slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
      ],
    })

    const card = findByTitle(await SystemBackupsPage(), 'Last four weeks')

    expect(card?.status).toBe('error')
    const weeks = card?.facts?.filter((f) => f.label.startsWith('Week '))
    expect(weeks?.map((f) => [f.label, f.tone])).toEqual([
      ['Week 47, 2026', 'default'],
      ['Week 46, 2026', 'error'],
      ['Week 45, 2026', 'error'],
      ['Week 44, 2026', 'default'],
    ])
    expect(weeks?.[0].value).toBe('slot 3 · Nov 22, 11:38')
    expect(weeks?.[1].value).toBe('Missing')
    expect(card?.note).toMatch(/^2 of the last four weeks have no backup/)
  })

  it('is complete when all four weeks have a slot', async () => {
    vi.setSystemTime(new Date('2026-12-15T09:00:00Z'))
    vi.mocked(listWeeklySlots).mockResolvedValue({
      status: 'ok',
      slots: [
        slot('weekly-slot-0.tar.gz', '2026-11-29T10:30:00Z', 48),
        slot('weekly-slot-1.tar.gz', '2026-12-06T10:30:00Z', 49),
        slot('weekly-slot-2.tar.gz', '2026-12-13T10:30:00Z', 50),
        slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
      ],
    })

    const result = await SystemBackupsPage()
    const card = findByTitle(result, 'Last four weeks')

    expect(card?.status).toBe('ok')
    expect(card?.facts?.every((f) => f.tone !== 'error')).toBe(true)
    expect(findByTitle(result, 'Older than four weeks')).toBeUndefined()
  })

  it('shows a slot left from before the rotation separately', async () => {
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
    vi.mocked(listWeeklySlots).mockResolvedValue({
      status: 'ok',
      slots: [
        slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
        slot('weekly-slot-1.tar.gz', '2026-10-11T10:00:00Z', 41),
      ],
    })

    const older = findByTitle(await SystemBackupsPage(), 'Older than four weeks')

    expect(older?.facts?.map((f) => f.label)).toEqual(['Week 41, 2026'])
  })

  it('flags the newest backup as too old once a run has been missed', async () => {
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'))
    vi.mocked(listWeeklySlots).mockResolvedValue({
      status: 'ok',
      slots: [slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47)],
    })

    const card = findByTitle(await SystemBackupsPage(), 'Last four weeks')

    expect(card?.facts?.[0]).toMatchObject({ label: 'Newest backup', tone: 'error' })
  })

  it.each([
    ['unconfigured', /Only production has weekly backups/],
    ['error', /could not be listed/],
  ] as const)('says why nothing is listed when the listing is %s', async (status, note) => {
    vi.mocked(listWeeklySlots).mockResolvedValue({ status })

    const card = findByTitle(await SystemBackupsPage(), 'Last four weeks')

    expect(card?.status).toBe('unknown')
    expect(card?.note).toMatch(note)
  })
})
