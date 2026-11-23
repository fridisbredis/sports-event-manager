import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OfficialLinkChrome } from './layout'
import { hasOfficialScreens, hasSystemAdminScreens } from '@/lib/auth/tenant'
import { SurfaceSwitchBar } from '@/components/navigation/surface-switch-bar'

vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getParticipantTenant: vi.fn(),
  hasOfficialScreens: vi.fn(),
  hasSystemAdminScreens: vi.fn(),
}))

vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/lib/i18n/user-language', () => ({
  getUserLanguage: vi.fn(async () => 'en'),
}))

vi.mock('@/lib/events/official-event', () => ({
  officialShiftsPath: vi.fn(async () => '/viadal/events/event-1/schedule'),
}))

vi.mock('@/components/navigation/surface-switch-bar', () => ({
  SurfaceSwitchBar: vi.fn(() => null),
}))

vi.mock('./_components/participant-tab-bar', () => ({
  ParticipantTabBar: vi.fn(() => null),
}))

async function linksFor(isOfficial: boolean, isSystemAdmin: boolean) {
  vi.mocked(hasOfficialScreens).mockResolvedValue(isOfficial)
  vi.mocked(hasSystemAdminScreens).mockResolvedValue(isSystemAdmin)
  const el = (await OfficialLinkChrome({ tenantSlug: 'viadal' })) as {
    type: unknown
    props: { links: { href: string; label: string }[] }
  } | null
  if (!el) return null
  expect(el.type).toBe(SurfaceSwitchBar)
  return el.props.links
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OfficialLinkChrome', () => {
  it('shows nothing to a plain participant', async () => {
    expect(await linksFor(false, false)).toBeNull()
  })

  it('offers My shifts to a participant who is also an official', async () => {
    const links = await linksFor(true, false)
    expect(links!.map((l) => l.href)).toEqual(['/viadal/events/event-1/schedule'])
  })

  // B19: the home-screen app has no address bar, so a system admin needs a
  // link back to /admin from every surface the system admin menu leads to.
  it('offers the way back to /admin to a system admin, first in the strip', async () => {
    const links = await linksFor(true, true)
    expect(links!.map((l) => l.href)).toEqual(['/admin', '/viadal/events/event-1/schedule'])
    expect(links![0].label).toBe('nav.systemAdminView')
  })
})
