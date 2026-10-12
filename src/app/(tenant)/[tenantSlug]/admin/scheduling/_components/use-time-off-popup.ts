import { useState, useEffect, useRef, useCallback } from 'react'
import type { TimeOffCell } from './time-off-popup'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'

/**
 * The open/closed state and screen position of the time-off cell popup.
 *
 * Separate from useSchedulingGridInteraction: that hook owns the modes that
 * interact with each other (the three pickers close one another), and this one
 * is independent of all of them. It lives in its own hook mainly because the
 * positioning is the part with real behaviour worth testing — dismissal by
 * Escape, and staying attached to a cell that moves under it.
 */
export function useTimeOffPopup() {
  const [cell, setCell] = useState<TimeOffCell | null>(null)

  // The cell element the popup is anchored to, kept so scrolling can re-read
  // its rect. A ref rather than state: it changes in lockstep with `cell` and
  // must already be set when the repositioning effect runs.
  const anchorRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => setCell(null), [])

  const open = useCallback(
    (officialName: string, periods: UnavailabilityPeriod[], anchor: HTMLElement) => {
      if (periods.length === 0) return
      const rect = anchor.getBoundingClientRect()
      anchorRef.current = anchor
      setCell({ officialName, periods, anchorTop: rect.bottom, anchorLeft: rect.left })
    },
    []
  )

  // Dismissal: a click anywhere outside, or Escape. Without the key there is
  // no way out at all for anyone not using a mouse, since a keyboard user
  // cannot produce a click outside.
  useEffect(() => {
    if (!cell) return
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('[data-time-off-popup]')) setCell(null)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setCell(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [cell])

  // The popup is positioned fixed off a rect read once at open time, so the
  // cell slides out from under it as soon as the grid scrolls sideways in its
  // own container. Re-reading the anchor's rect keeps the two together; once
  // the anchor has left the scroll viewport there is no cell left to point at,
  // so the popup closes rather than clinging to an edge.
  //
  // Keyed on whether a popup is open rather than on its moving coordinates:
  // depending on the whole cell would tear these listeners down and rebuild
  // them on every scroll frame this effect itself causes.
  const isOpen = cell !== null
  useEffect(() => {
    const anchor = anchorRef.current
    if (!isOpen || !anchor) return

    function reposition() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const container = el.closest('.scheduling-scroll-container')
      if (container) {
        const bounds = container.getBoundingClientRect()
        const hidden =
          rect.right <= bounds.left ||
          rect.left >= bounds.right ||
          rect.bottom <= bounds.top ||
          rect.top >= bounds.bottom
        if (hidden) {
          setCell(null)
          return
        }
      }
      setCell((prev) => (prev ? { ...prev, anchorTop: rect.bottom, anchorLeft: rect.left } : prev))
    }

    const container = anchor.closest('.scheduling-scroll-container')
    container?.addEventListener('scroll', reposition)
    // Capture phase so a scrolling ancestor counts too, not just the window.
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      container?.removeEventListener('scroll', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [isOpen])

  return { cell, open, close }
}
