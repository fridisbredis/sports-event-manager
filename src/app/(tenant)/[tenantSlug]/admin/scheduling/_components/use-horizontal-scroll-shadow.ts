'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Tracks whether a horizontally scrollable element is scrolled away from its
 * left edge.
 *
 * The frozen first column of the scheduling grids casts an edge shadow, which
 * only means something once there is content hidden behind the column. Sitting
 * at offset 0 the shadow is just a grey band down an unbroken white surface,
 * so the grids use this to hold it back until scrolling actually starts.
 *
 * Returns the ref to attach to the scroll container and the current state.
 */
export function useHorizontalScrollShadow() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [isScrolled, setIsScrolled] = useState(false)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    setIsScrolled(el.scrollLeft > 0)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Read once on mount: the browser restores scroll position on back
    // navigation, so the container can already be scrolled before any event
    // fires.
    sync()

    el.addEventListener('scroll', sync, { passive: true })
    return () => el.removeEventListener('scroll', sync)
  }, [sync])

  return { scrollRef: ref, isScrolled }
}
