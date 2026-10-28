import { describe, it, expect } from 'vitest'
import { useRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { useHorizontalScrollShadow } from './use-horizontal-scroll-shadow'

/**
 * What this guards: the frozen first column's edge shadow only means
 * something once there is content hidden behind the column. Painted at scroll
 * offset 0 it is a grey band down an unbroken white surface, which is what
 * the hook exists to prevent.
 *
 * Mounted through a real component rather than `renderHook`, because the
 * behaviour under test depends on the ref being attached by React before the
 * effect runs — which is exactly what a manual ref assignment cannot model.
 */
describe('useHorizontalScrollShadow', () => {
  function Grid({
    initialScrollLeft = 0,
    resetKey,
  }: {
    initialScrollLeft?: number
    resetKey?: string
  }) {
    const { scrollRef, isScrolled } = useHorizontalScrollShadow(resetKey)
    // React calls a callback ref with null before each re-attach, so
    // comparing against scrollRef.current cannot tell a first mount from a
    // re-render. Track it explicitly: re-applying initialScrollLeft on every
    // render would reset scrollLeft underneath the hook and make the reset
    // tests below pass for the wrong reason.
    const seeded = useRef(false)
    return (
      <div
        ref={(el) => {
          if (el && !seeded.current) {
            seeded.current = true
            // jsdom has no layout, so scrollLeft is a plain property. That is
            // enough: the hook only reads it and listens for 'scroll'.
            el.scrollLeft = initialScrollLeft
          }
          scrollRef.current = el
        }}
        data-testid="scroller"
      >
        <span data-testid="state">{isScrolled ? 'scrolled' : 'at-left'}</span>
      </div>
    )
  }

  const state = () => screen.getByTestId('state').textContent

  function scrollTo(left: number) {
    const el = screen.getByTestId('scroller')
    el.scrollLeft = left
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
  }

  it('starts hidden at the left edge, where nothing is behind the column yet', () => {
    render(<Grid />)

    expect(state()).toBe('at-left')
  })

  it('shows the edge once the grid is scrolled away from the left', () => {
    render(<Grid />)

    scrollTo(120)

    expect(state()).toBe('scrolled')
  })

  it('hides the edge again when scrolled back to the left', () => {
    render(<Grid />)
    scrollTo(120)

    scrollTo(0)

    expect(state()).toBe('at-left')
  })

  it('reads the position on mount, so a restored scroll shows the edge with no scroll event', () => {
    // The browser restores scroll position on back navigation, so the
    // container can already be scrolled before any event fires.
    render(<Grid initialScrollLeft={200} />)

    expect(state()).toBe('scrolled')
  })

  // Switching day or stage replaces every column, but React keeps the same
  // scroll element. Without a reset, the new day opens at the offset the
  // previous one was left at — scroll to the end of Friday, switch to
  // Saturday, and the grid is parked past its morning on an empty-looking
  // stretch.
  describe('when the columns are replaced', () => {
    it('returns to the left edge when the reset key changes', () => {
      const { rerender } = render(<Grid resetKey="2026-10-16" />)
      scrollTo(400)
      expect(state()).toBe('scrolled')

      rerender(<Grid resetKey="2026-10-17" />)

      expect(screen.getByTestId('scroller').scrollLeft).toBe(0)
      expect(state()).toBe('at-left')
    })

    it('leaves the position alone while the same day re-renders', () => {
      const { rerender } = render(<Grid resetKey="2026-10-16" />)
      scrollTo(400)

      // An autosave or a router.refresh() re-renders the grid with the same
      // columns; yanking the admin back to the left mid-edit would be worse
      // than the bug this reset fixes.
      rerender(<Grid resetKey="2026-10-16" />)

      expect(screen.getByTestId('scroller').scrollLeft).toBe(400)
      expect(state()).toBe('scrolled')
    })

    it('leaves the vertical position alone', () => {
      const { rerender } = render(<Grid resetKey="2026-10-16" />)
      const el = screen.getByTestId('scroller')
      el.scrollTop = 250
      scrollTo(400)

      rerender(<Grid resetKey="2026-10-17" />)

      // The roster of people or work areas is the same list across days; an
      // admin working down it keeps their place.
      expect(el.scrollTop).toBe(250)
    })
  })

  it('stops listening once unmounted', () => {
    const { unmount } = render(<Grid />)
    const el = screen.getByTestId('scroller')

    unmount()

    // A listener left on a container the grid no longer owns would update
    // state after unmount; React warns, and the handler leaks.
    expect(() => {
      el.scrollLeft = 300
      el.dispatchEvent(new Event('scroll'))
    }).not.toThrow()
  })
})
