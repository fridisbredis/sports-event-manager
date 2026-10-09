import { describe, it, expect } from 'vitest'
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
  function Grid({ initialScrollLeft = 0 }: { initialScrollLeft?: number }) {
    const { scrollRef, isScrolled } = useHorizontalScrollShadow()
    return (
      <div
        ref={(el) => {
          if (el) {
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
