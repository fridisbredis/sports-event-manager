import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ParticipantEventInfoPage from './page'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getEventInfoCached, type EventInfoCached } from '@/lib/events/event-info-cached'

vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getParticipantTenant: vi.fn(),
}))

vi.mock('@/lib/events/event-info-cached', () => ({ getEventInfoCached: vi.fn() }))

vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn().mockResolvedValue('en') }))

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

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function params(eventId = 'event-1') {
  return Promise.resolve({ tenantSlug: 'viadal', eventId })
}

function mockParticipant(tier = 'premium') {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
  vi.mocked(getParticipantTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    tier,
    is_active: true,
    entries: [{ participantId: 'p1', eventId: 'event-1' }],
  })
}

const stage = (id: string, name: string, stage_type: string, position: number) => ({
  id,
  name,
  stage_type,
  position,
  stage_date: null,
  start_time: null,
  end_time: null,
  venue: null,
  results_url: null,
})

function mockInfo(status: string): void {
  const info: EventInfoCached = {
    event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null, status },
    stages: [stage('s1', '6dagars', 'race', 0), stage('expo', 'Expo', 'non_race', 1)],
    info_sections: [
      {
        id: 'i1',
        title: 'Parking',
        body: 'North lot',
        image_path: null,
        link_url: null,
        link_label: null,
        position: 0,
      },
    ],
  }
  vi.mocked(getEventInfoCached).mockResolvedValue(info)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParticipantEventInfoPage', () => {
  it('redirects to /login without a user', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(ParticipantEventInfoPage({ params: params() })).rejects.toThrow('NEXT_REDIRECT')
  })

  it('is not found for a caller who is not a participant here', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(getParticipantTenant).mockResolvedValue(null)

    await expect(ParticipantEventInfoPage({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // The cached RPC answers for any event in the tenant, so the page itself
  // must refuse an event the runner is not entered in.
  it('is not found for a sibling event, without reading it', async () => {
    mockParticipant()

    await expect(ParticipantEventInfoPage({ params: params('event-2') })).rejects.toThrow(
      'NEXT_NOT_FOUND'
    )
    expect(getEventInfoCached).not.toHaveBeenCalled()
  })

  it('shows info sections and Race stages only, for an open event', async () => {
    mockParticipant()
    mockInfo('published')

    render(await ParticipantEventInfoPage({ params: params() }))

    expect(screen.getByText('Parking')).toBeTruthy()
    expect(screen.getByText('6dagars')).toBeTruthy()
    expect(screen.queryByText('Expo')).toBeNull()
  })

  it('shows only the not-available notice while the event is draft', async () => {
    mockParticipant()
    mockInfo('draft')

    render(await ParticipantEventInfoPage({ params: params() }))

    expect(screen.getByText('participant.home.notAvailable')).toBeTruthy()

    expect(screen.getByText('participant.home.notAvailableTitle')).toBeTruthy()
    expect(screen.queryByText('Parking')).toBeNull()
    expect(screen.queryByText('6dagars')).toBeNull()
  })

  it('stays closed on a tier without the participant side', async () => {
    mockParticipant('standard')
    mockInfo('published')

    render(await ParticipantEventInfoPage({ params: params() }))

    expect(screen.getByText('participant.home.notAvailable')).toBeTruthy()

    expect(screen.getByText('participant.home.notAvailableTitle')).toBeTruthy()
  })
})
