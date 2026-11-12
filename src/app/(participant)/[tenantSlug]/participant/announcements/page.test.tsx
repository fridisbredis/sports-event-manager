import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ParticipantAnnouncementsPage from './page'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { loadParticipantAnnouncements } from '@/lib/participants/participant-announcements'

vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getParticipantTenant: vi.fn(),
}))

vi.mock('@/lib/participants/participant-announcements', () => ({
  loadParticipantAnnouncements: vi.fn(),
}))

vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn().mockResolvedValue('en') }))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn().mockResolvedValue((key: string) => key),
}))

vi.mock('@/lib/i18n/announcement-time', () => ({
  formatAnnouncementTime: () => 'Today · 08:15',
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function search(page?: string) {
  return Promise.resolve(page ? { page } : {})
}

function signedIn() {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getParticipantTenant).mockResolvedValue({ id: 't1', entries: [] } as never)
}

async function renderPage(page?: string) {
  render(await ParticipantAnnouncementsPage({ params: PARAMS, searchParams: search(page) }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParticipantAnnouncementsPage (ANN-02, N44)', () => {
  it('redirects to login without a user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    await expect(
      ParticipantAnnouncementsPage({ params: PARAMS, searchParams: search() })
    ).rejects.toThrow('NEXT_REDIRECT')
  })

  it('is notFound for someone with no participant record in the tenant', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getParticipantTenant).mockResolvedValue(null)
    await expect(
      ParticipantAnnouncementsPage({ params: PARAMS, searchParams: search() })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('shows the not-available notice when the event is unpublished', async () => {
    signedIn()
    vi.mocked(loadParticipantAnnouncements).mockResolvedValue({ open: false })

    await renderPage()

    expect(screen.getByText('participant.home.notAvailable')).toBeDefined()

    expect(screen.getByText('participant.home.notAvailableTitle')).toBeDefined()
    expect(screen.queryByText('announcements.noAnnouncements')).toBeNull()
  })

  it('shows the empty state when nothing is published yet', async () => {
    signedIn()
    vi.mocked(loadParticipantAnnouncements).mockResolvedValue({
      open: true,
      items: [],
      hasMore: false,
    })

    await renderPage()

    expect(screen.getByText('announcements.noAnnouncements')).toBeDefined()
  })

  it('lists announcements, naming the event only when given', async () => {
    signedIn()
    vi.mocked(loadParticipantAnnouncements).mockResolvedValue({
      open: true,
      hasMore: false,
      items: [
        { id: 'a1', body: 'Start moved to 12:30', publishedAt: 'x', eventName: null },
        { id: 'a2', body: 'Parking full', publishedAt: 'x', eventName: 'Viadal 2026' },
      ],
    })

    await renderPage()

    expect(screen.getByText('Start moved to 12:30')).toBeDefined()
    expect(screen.getByText('Today · 08:15')).toBeDefined()
    expect(screen.getByText('Viadal 2026 · Today · 08:15')).toBeDefined()
    // Read-only: nothing to act on but paging.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers older and newer pages', async () => {
    signedIn()
    vi.mocked(loadParticipantAnnouncements).mockResolvedValue({
      open: true,
      hasMore: true,
      items: [{ id: 'a1', body: 'b', publishedAt: 'x', eventName: null }],
    })

    await renderPage('2')

    expect(loadParticipantAnnouncements).toHaveBeenCalledWith(expect.anything(), 2)
    expect(screen.getByText('announcements.older').getAttribute('href')).toBe('?page=3')
    expect(screen.getByText('announcements.newer').getAttribute('href')).toBe('?page=1')
  })

  it('says past-the-end rather than nothing published', async () => {
    signedIn()
    vi.mocked(loadParticipantAnnouncements).mockResolvedValue({
      open: true,
      items: [],
      hasMore: false,
    })

    await renderPage('4')

    expect(screen.getByText('announcements.noOlderAnnouncements')).toBeDefined()
    expect(screen.queryByText('announcements.noAnnouncements')).toBeNull()
  })
})
