'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Measures the grid's sticky time header so rows beneath it can park directly
 * under it.
 *
 * The by-work-area grid pins each work area's summary row while its numbered
 * slot rows scroll past, which needs a `top` offset equal to the header's
 * height. That height is not a constant worth hardcoding: it follows the
 * header's padding and type scale, so a styling change would silently leave
 * the summary row overlapping the header or floating below it. Measuring
 * keeps the two in step.
 *
 * Returns a ref for the header ROW and its current height in pixels.
 */
export function useStickyHeaderOffset() {
  const ref = useRef<HTMLTableRowElement | null>(null)
  const [offset, setOffset] = useState(0)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Measure the whole header ROW, not one of its cells. Cells in a row are
    // all as tall as the tallest, and the corner cell is `text-xs` while the
    // time cells are `text-[13px]` — so measuring the corner reports a height
    // a few pixels short of the row the pinned summary has to clear, which is
    // exactly the seam slot rows show through.
    //
    // `offsetHeight` rather than getBoundingClientRect: the header is itself
    // sticky, so a viewport-relative measurement changes as you scroll.
    //
    // Minus one so the pinned row can only ever park a hair high. Overlapping
    // the header by a subpixel is invisible — the header paints above it —
    // while parking a subpixel low reopens the seam.
    setOffset(Math.max(0, el.offsetHeight - 1))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    measure()

    // The header reflows with the container — a resized window, the sidebar
    // collapsing, a font swapping in — and each changes the offset the rows
    // below depend on.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  return { headerRef: ref, headerOffset: offset }
}
