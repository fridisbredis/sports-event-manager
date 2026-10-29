import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import en from '../../../../../../../../../public/locales/en/admin.json'
import { MobileCoverageView } from './mobile-coverage-view'
import type { WorkAreaCoverage } from '@/lib/scheduling/coverage'

// Resolve against the real locale file rather than a hand-written map, so a
// renamed or deleted key fails here instead of silently rendering its own
// name as the label. Interpolates {{count}} so the plural keys are exercised
// as i18next would resolve them.
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const count = vars?.count
      const path = typeof count === 'number' ? `${key}_${count === 1 ? 'one' : 'other'}` : key
      const value = path
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
          en
        )
      if (typeof value !== 'string') throw new Error(`missing translation key: ${path}`)
      return typeof count === 'number' ? value.replace('{{count}}', String(count)) : value
    },
  }),
}))

vi.mock('@/components/i18n-provider', () => ({ useLanguage: () => 'en' }))

vi.mock('next/navigation', () => ({
  useParams: () => ({ tenantSlug: 'seed-klubben', eventId: 'event-1' }),
}))

const S = en.scheduling
const DAY = '2026-08-02'
const NEXT_DAY = '2026-08-03'

function area(over: Partial<WorkAreaCoverage> = {}): WorkAreaCoverage {
  return {
    workstationId: 'ws-finish',
    name: 'Finish line',
    color: null,
    shifts: [],
    ...over,
  }
}

function shift(officialId: string, name: string, from: string, to: string) {
  return {
    officialId,
    officialName: name,
    start: `${DAY}T${from}:00.000Z`,
    end: `${DAY}T${to}:00.000Z`,
  }
}

function renderView(props: Partial<Parameters<typeof MobileCoverageView>[0]> = {}) {
  return render(
    <MobileCoverageView days={[DAY]} selectedDay={DAY} areas={[area()]} ok={true} {...props} />
  )
}

/**
 * What this guards: the view exists so an admin standing at an event can see
 * whether a work area is covered. The two ways it can lie about that — an
 * unstaffed area reading as ordinary, and a failed read reading as an empty
 * schedule — are the cases below.
 */
describe('MobileCoverageView', () => {
  it('says it is read-only, so nobody hunts for an edit control', () => {
    renderView()

    expect(screen.getByText(S.mobileSubtitle)).toBeTruthy()
  })

  it('lists each shift with its time span and who is working it', () => {
    renderView({
      areas: [area({ shifts: [shift('a', 'Anna', '07:00', '10:00')] })],
    })

    expect(screen.getByText('Anna')).toBeTruthy()
    expect(screen.getByText(/07:00.*10:00/)).toBeTruthy()
  })

  // The single most useful thing this screen can say. A work area with nobody
  // on it must be called out, not merely left blank.
  it('calls out a work area with nobody assigned', () => {
    renderView({ areas: [area({ shifts: [] })] })

    expect(screen.getByText(S.mobileUnstaffed)).toBeTruthy()
  })

  it('counts the shifts on a staffed area and omits the count on an empty one', () => {
    const { rerender } = renderView({
      areas: [
        area({
          shifts: [shift('a', 'Anna', '07:00', '09:00'), shift('b', 'Bo', '09:00', '11:00')],
        }),
      ],
    })
    expect(screen.getByText('2 shifts')).toBeTruthy()

    rerender(
      <MobileCoverageView days={[DAY]} selectedDay={DAY} areas={[area({ shifts: [] })]} ok={true} />
    )
    expect(screen.queryByText(/shift/)).toBeNull()
  })

  // "Nobody is assigned" and "the read failed" render the same way, so a
  // failure has to say so — otherwise it reads as all-clear on the one screen
  // where that matters most.
  it('warns when the coverage read failed rather than implying an empty day', () => {
    renderView({ ok: false })

    expect(screen.getByRole('status')).toHaveTextContent(S.mobileLoadFailed)
  })

  it('shows no failure notice on a successful read', () => {
    renderView({ ok: true })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows an empty state when the stage has no work areas', () => {
    renderView({ areas: [] })

    expect(screen.getByText(S.mobileNoWorkAreas)).toBeTruthy()
  })
})

describe('MobileCoverageView — day tabs', () => {
  it('links each day to the same route, so the day survives a reload', () => {
    renderView({ days: [DAY, NEXT_DAY], selectedDay: DAY })

    const tabs = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute(
      'href',
      `/seed-klubben/admin/events/event-1/scheduling?day=${DAY}`
    )
  })

  it('marks the selected day for assistive tech', () => {
    renderView({ days: [DAY, NEXT_DAY], selectedDay: NEXT_DAY })

    const tabs = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(tabs[1]).toHaveAttribute('aria-current', 'page')
    expect(tabs[0]).not.toHaveAttribute('aria-current')
  })

  // A lone tab that only ever leads back to the page it is on reads as a
  // control that does nothing — but the day still has to be named, because
  // the times below carry no date.
  it('names a single day as a label rather than a one-item tab row', () => {
    renderView({ days: [DAY], selectedDay: DAY })

    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByText(/2 Aug/)).toBeTruthy()
  })
})
