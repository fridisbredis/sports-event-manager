import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useStickyHeaderOffset } from './use-sticky-header-offset'

/**
 * What this guards: the by-work-area grid pins each work area's summary row
 * under the time header while its numbered slot rows scroll past. The offset
 * it parks at comes from this hook, and getting it wrong is visible — too
 * small and the row covers the header, too large and slot rows show through
 * the seam between them.
 *
 * jsdom reports every element as 0×0, so `offsetHeight` is stubbed per test
 * to stand in for layout.
 */
describe('useStickyHeaderOffset', () => {
  let observed: Element[] = []
  let triggerResize: (() => void) | undefined

  beforeEach(() => {
    observed = []
    triggerResize = undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          triggerResize = cb
        }
        observe(el: Element) {
          observed.push(el)
        }
        disconnect() {
          observed = []
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function Header({ height }: { height: number }) {
    const { headerRef, headerOffset } = useStickyHeaderOffset()
    return (
      <table>
        <thead>
          <tr
            ref={(el) => {
              if (el) {
                Object.defineProperty(el, 'offsetHeight', {
                  value: height,
                  configurable: true,
                })
              }
              headerRef.current = el
            }}
            data-testid="header"
          >
            <th data-testid="offset">{headerOffset}</th>
          </tr>
        </thead>
      </table>
    )
  }

  const offset = () => Number(screen.getByTestId('offset').textContent)

  it('measures the header row on mount', () => {
    render(<Header height={45} />)

    // One pixel under the measured height: the pinned row should tuck behind
    // the header rather than meet its edge, since landing a subpixel low
    // reopens the seam while overlapping is hidden by the header itself.
    expect(offset()).toBe(44)
  })

  it('measures the row, not a single cell, so the tallest cell sets the height', () => {
    // The corner cell is text-xs while the time cells are text-[13px]; a
    // cell-based measurement reports a height several pixels short of the row
    // the pinned summary actually has to clear.
    render(<Header height={52} />)

    expect(offset()).toBe(51)
  })

  it('never returns a negative offset for a header with no height yet', () => {
    render(<Header height={0} />)

    expect(offset()).toBe(0)
  })

  it('observes the header so a reflow re-measures it', () => {
    render(<Header height={45} />)

    expect(observed).toHaveLength(1)
    expect(observed[0]).toBe(screen.getByTestId('header'))
  })

  it('re-measures when the header reflows', () => {
    render(<Header height={45} />)
    const header = screen.getByTestId('header')

    // A resized window, a collapsing sidebar, or a font swapping in all
    // change the height the rows below depend on.
    Object.defineProperty(header, 'offsetHeight', { value: 60, configurable: true })
    act(() => {
      triggerResize?.()
    })

    expect(offset()).toBe(59)
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Header height={45} />)

    unmount()

    expect(observed).toHaveLength(0)
  })
})
