import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EventInfoPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

// PERF-06 / F-PERF-04 Phase 2: unstable_cache would otherwise need a real
// Next.js request/cache context (same "static generation store missing"
// problem revalidateTag hits in these unit tests) — mocked as a passthrough
// so the wrapped function runs directly and these tests exercise it without
// caching or its context requirements getting in the way.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))

// getOfficialTenant resolves the tenant only after the official-surface
// access check passes, so a null return means either "no such tenant" or
// "not authorized" — both are notFound() to the caller, by design.
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getOfficialTenant: vi.fn(),
}))

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
const PARAMS = Promise.resolve({ tenantSlug: 'viadal' })

function mockUser(userId: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue((userId ? { id: userId } : null) as never)
}

function mockResolvedTenant() {
  vi.mocked(getOfficialTenant).mockResolvedValue({
    id: TENANT_ID,
    slug: 'viadal',
    color_palette: 'default',
    is_active: true,
    officialId: null,
  })
}

// PERF-06 / F-PERF-04 Phase 2: the event/stages/facilities reads moved off
// the session client onto get_event_info_cached (migration 0051) via the
// service-role client — see the page's own comment for why.
function mockEventInfoRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result)
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EventInfoPage', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockUser(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_REDIRECT')
    expect(getOfficialTenant).not.toHaveBeenCalled()
  })

  it('calls notFound when getOfficialTenant denies access or the tenant is missing', async () => {
    mockUser('user-1')
    vi.mocked(getOfficialTenant).mockResolvedValue(null)

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getOfficialTenant).toHaveBeenCalledWith('viadal')
  })

  it('reads event, stages, and facilities via the cached RPC scoped by tenant_id', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    const rpc = mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [],
        facilities: [],
      },
      error: null,
    })

    await EventInfoPage({ params: PARAMS })

    expect(rpc).toHaveBeenCalledWith('get_event_info_cached', {
      p_tenant_id: TENANT_ID,
    })
  })

  it('renders successfully with empty stages and facilities lists', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({ data: { event: null, stages: [], facilities: [] }, error: null })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  // The dates-by-stage section derives a stage's day from start_time when it
  // is set and from stage_date otherwise, so a stage whose hour has not been
  // pinned yet still appears. Both branches render through the same page, so
  // these assert the page builds rather than re-testing the formatter.
  it('renders stages that carry only stage_date, with no start_time', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Stage 1',
            stage_type: 'race',
            stage_date: '2026-06-12',
            start_time: null,
            end_time: null,
            venue: 'Town Square',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  it('renders stages that carry neither a date nor a venue', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Setup',
            stage_type: 'non_race',
            stage_date: null,
            start_time: null,
            end_time: null,
            venue: null,
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    const result = await EventInfoPage({ params: PARAMS })

    expect(result).toBeTruthy()
  })

  // The day, hours and venue of one stage used to be spread over three
  // sections that each re-listed every stage. They are now one card, so this
  // asserts the merged shape rather than just that the page builds: a
  // regression that split them again would otherwise pass unnoticed.
  it('shows a stage day, hours and venue together on one card', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Day 1',
            stage_type: 'race',
            stage_date: null,
            start_time: '2026-06-12T07:00:00Z',
            end_time: '2026-06-12T22:00:00Z',
            venue: 'Seed Stadium',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    // The stage name appears once now, not once per section.
    expect(screen.getAllByText('Day 1')).toHaveLength(1)

    const card = screen.getByText('Day 1').closest('div')?.parentElement as HTMLElement
    expect(card).toHaveTextContent('07:00')
    expect(card).toHaveTextContent('22:00')
    expect(card).toHaveTextContent('Seed Stadium')
  })

  // The results link is the one thing on this card that is tappable, so it
  // is asserted as a link with its href — a regression that rendered it as
  // plain text would still contain the label and pass a text-only check.
  it('shows a stage results link as a real link', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Day 1',
            stage_type: 'race',
            stage_date: null,
            start_time: '2026-06-12T07:00:00Z',
            end_time: '2026-06-12T22:00:00Z',
            venue: null,
            results_url: 'https://results.example.com/viadal',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    // getServerTranslation is mocked as identity above, so the label the
    // card renders is the key itself.
    const link = screen.getByRole('link', { name: 'eventInfo.raceResults' })
    expect(link).toHaveAttribute('href', 'https://results.example.com/viadal')
    // Opens away from the app, so the official keeps this screen behind it.
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('copies the results URL to the clipboard from the button beside the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // jsdom ships no clipboard implementation, so the button needs one to
    // call. Defined rather than assigned: navigator.clipboard is read-only.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Day 1',
            stage_type: 'race',
            stage_date: null,
            start_time: '2026-06-12T07:00:00Z',
            end_time: null,
            venue: null,
            results_url: 'https://results.example.com/viadal',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    fireEvent.click(screen.getByRole('button', { name: 'eventInfo.copyResultsLink' }))

    // The URL itself is copied, not the visible label.
    expect(writeText).toHaveBeenCalledWith('https://results.example.com/viadal')

    // The acknowledgement rides on the accessible name, so the icon-only
    // button confirms the copy without the row reflowing under the thumb.
    expect(
      await screen.findByRole('button', { name: 'eventInfo.resultsLinkCopied' })
    ).toBeInTheDocument()
  })

  it('leaves the copy button unacknowledged when the clipboard write is refused', async () => {
    // Insecure origins and denied permissions both reject here. A failed copy
    // must not claim success — the official would paste stale content.
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Day 1',
            stage_type: 'race',
            stage_date: null,
            start_time: '2026-06-12T07:00:00Z',
            end_time: null,
            venue: null,
            results_url: 'https://results.example.com/viadal',
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    fireEvent.click(screen.getByRole('button', { name: 'eventInfo.copyResultsLink' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'eventInfo.resultsLinkCopied' })).toBeNull()
    expect(screen.getByRole('button', { name: 'eventInfo.copyResultsLink' })).toBeInTheDocument()
  })

  it('shows no results link for a stage that has none', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Setup',
            stage_type: 'non_race',
            stage_date: null,
            start_time: '2026-06-11T07:00:00Z',
            end_time: null,
            venue: null,
            results_url: null,
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    expect(screen.queryByRole('link', { name: 'eventInfo.raceResults' })).toBeNull()
    // Nothing to copy, so the button goes with the link.
    expect(screen.queryByRole('button', { name: 'eventInfo.copyResultsLink' })).toBeNull()
  })

  // The Viadal race runs 2 Aug 12:00 through 8 Aug 12:00. Formatting only the
  // start's day and then both clock times rendered that as
  // "Sun, 2 Aug · 12:00 – 12:00", which reads as a zero-length stage.
  it('shows both dates for a stage that spans several days', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({
      data: {
        event: { name: 'Viadal 2026', event_type: 'race', description: null, logo_url: null },
        stages: [
          {
            id: 'stage-1',
            name: 'Race',
            stage_type: 'race',
            stage_date: null,
            start_time: '2026-08-02T12:00:00+00:00',
            end_time: '2026-08-08T12:00:00+00:00',
            venue: null,
            position: 0,
          },
        ],
        facilities: [],
      },
      error: null,
    })

    render(await EventInfoPage({ params: PARAMS }))

    const card = screen.getByText('Race').closest('div')?.parentElement as HTMLElement
    expect(card).toHaveTextContent('Sun, 2 Aug 12:00 – Sat, 8 Aug 12:00')
    // The start day is carried by the range itself, not repeated beside it.
    expect(card?.textContent?.match(/2 Aug/g)).toHaveLength(1)
  })

  it('throws when the RPC returns an error', async () => {
    mockResolvedTenant()
    mockUser('user-1')
    mockEventInfoRpc({ data: null, error: new Error('rpc failed') })

    await expect(EventInfoPage({ params: PARAMS })).rejects.toThrow('rpc failed')
  })
})
