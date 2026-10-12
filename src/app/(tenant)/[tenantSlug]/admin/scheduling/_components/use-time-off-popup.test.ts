import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTimeOffPopup } from './use-time-off-popup'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'

/** One admin-set period; the content is irrelevant to positioning. */
const PERIODS = [
  {
    id: 'p1',
    official_id: 'o1',
    starts_at: '2026-10-12T00:00:00.000Z',
    ends_at: '2026-10-13T00:00:00.000Z',
    created_by_role: 'tenant_admin',
  },
] as unknown as UnavailabilityPeriod[]

/**
 * A cell inside a scroll container, both with controllable rects. The grid's
 * real geometry comes from layout, which jsdom does not do, so each element's
 * getBoundingClientRect is stubbed and moved by hand.
 */
function buildAnchor() {
  const container = document.createElement('div')
  container.className = 'scheduling-scroll-container'
  const anchor = document.createElement('button')
  container.appendChild(anchor)
  document.body.appendChild(container)

  const containerBounds = { left: 0, right: 500, top: 0, bottom: 400 }
  container.getBoundingClientRect = () =>
    ({ ...containerBounds, width: 500, height: 400, x: 0, y: 0 }) as DOMRect

  let cellRect = { left: 100, right: 180, top: 50, bottom: 80 }
  anchor.getBoundingClientRect = () =>
    ({
      ...cellRect,
      width: cellRect.right - cellRect.left,
      height: cellRect.bottom - cellRect.top,
      x: cellRect.left,
      y: cellRect.top,
    }) as DOMRect

  return {
    container,
    anchor,
    /** Simulate a sideways scroll of the grid by dx pixels. */
    scrollBy(dx: number) {
      cellRect = { ...cellRect, left: cellRect.left - dx, right: cellRect.right - dx }
      container.dispatchEvent(new Event('scroll'))
    },
  }
}

describe('useTimeOffPopup', () => {
  let dom: ReturnType<typeof buildAnchor>

  beforeEach(() => {
    dom = buildAnchor()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens anchored to the cell it was given', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    expect(result.current.cell).toBeNull()

    act(() => result.current.open('Anna', PERIODS, dom.anchor))

    expect(result.current.cell).toMatchObject({
      officialName: 'Anna',
      anchorTop: 80,
      anchorLeft: 100,
    })
  })

  it('stays closed for a cell with no periods', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', [], dom.anchor))
    expect(result.current.cell).toBeNull()
  })

  it('closes on Escape', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', PERIODS, dom.anchor))
    expect(result.current.cell).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.cell).toBeNull()
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', PERIODS, dom.anchor))

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    expect(result.current.cell).not.toBeNull()
  })

  it('follows its cell when the grid scrolls sideways', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', PERIODS, dom.anchor))
    expect(result.current.cell?.anchorLeft).toBe(100)

    act(() => dom.scrollBy(60))

    // Still open, now pointing at where the cell actually is.
    expect(result.current.cell?.anchorLeft).toBe(40)
    expect(result.current.cell?.anchorTop).toBe(80)
  })

  it('closes once its cell has scrolled out of the container', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', PERIODS, dom.anchor))

    // Far enough left that the cell's right edge passes the container's left.
    act(() => dom.scrollBy(200))

    expect(result.current.cell).toBeNull()
  })

  it('stops listening once closed', () => {
    const { result } = renderHook(() => useTimeOffPopup())
    act(() => result.current.open('Anna', PERIODS, dom.anchor))
    act(() => result.current.close())
    expect(result.current.cell).toBeNull()

    // A scroll after closing must not resurrect the popup.
    act(() => dom.scrollBy(10))
    expect(result.current.cell).toBeNull()
  })
})
