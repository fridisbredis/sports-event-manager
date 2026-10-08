import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useArmedAfterGesture } from './use-armed-after-gesture'

/**
 * The bug this guards: a drag-to-paint gesture opens its picker from its own
 * `pointerup`, and the browser then delivers that same release as a `click`
 * to whatever now sits under the pointer — a row of the freshly mounted list.
 * A picker that trusted that click chose an option the instant the drag ended.
 */
describe('useArmedAfterGesture', () => {
  function clickOn(target: EventTarget) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  describe('opened mid-gesture', () => {
    it('starts disarmed, so the click ending the gesture cannot choose a row', () => {
      const { result } = renderHook(() => useArmedAfterGesture(true))

      expect(result.current).toBe(false)
    })

    it('stops the stray click from reaching a row below it', () => {
      const row = document.createElement('button')
      document.body.appendChild(row)
      const onRowClick = vi.fn()
      row.addEventListener('click', onRowClick)

      renderHook(() => useArmedAfterGesture(true))
      clickOn(row)

      expect(onRowClick).not.toHaveBeenCalled()
      row.remove()
    })

    it('arms after that one click, so the next one is the user choosing', () => {
      const { result } = renderHook(() => useArmedAfterGesture(true))

      clickOn(document.body)

      expect(result.current).toBe(true)
    })

    it('lets a later click through to a row', () => {
      const row = document.createElement('button')
      document.body.appendChild(row)
      const onRowClick = vi.fn()
      row.addEventListener('click', onRowClick)

      renderHook(() => useArmedAfterGesture(true))
      clickOn(row)
      clickOn(row)

      expect(onRowClick).toHaveBeenCalledTimes(1)
      row.remove()
    })

    it('stops listening once unmounted', () => {
      const row = document.createElement('button')
      document.body.appendChild(row)
      const onRowClick = vi.fn()
      row.addEventListener('click', onRowClick)

      const { unmount } = renderHook(() => useArmedAfterGesture(true))
      unmount()
      clickOn(row)

      expect(onRowClick).toHaveBeenCalledTimes(1)
      row.remove()
    })
  })

  // A surface opened by an ordinary click is already past the release that
  // opened it. Swallowing a click there would eat the user's next real one.
  describe('opened by a click', () => {
    it('starts armed', () => {
      const { result } = renderHook(() => useArmedAfterGesture(false))

      expect(result.current).toBe(true)
    })

    it('lets the very next click reach a row', () => {
      const row = document.createElement('button')
      document.body.appendChild(row)
      const onRowClick = vi.fn()
      row.addEventListener('click', onRowClick)

      renderHook(() => useArmedAfterGesture(false))
      clickOn(row)

      expect(onRowClick).toHaveBeenCalledTimes(1)
      row.remove()
    })
  })
})
