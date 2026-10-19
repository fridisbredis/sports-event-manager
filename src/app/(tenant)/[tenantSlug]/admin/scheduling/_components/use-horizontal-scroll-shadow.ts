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
 * `resetKey` identifies which set of columns is on screen. When it changes,
 * the container is scrolled back to its left edge: switching day or stage
 * replaces every column, but React keeps the same scroll element, so without
 * this the new day opens at whatever offset the previous one was left at —
 * an admin who scrolled to the end of Friday lands past the end of Saturday's
 * morning, looking at an apparently empty grid.
 *
 * Returns the ref to attach to the scroll container and the current state.
 */
export function useHorizontalScrollShadow(resetKey?: string) {
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

  // Deliberately separate from the listener effect above, which must not be
  // torn down and rebuilt whenever the day changes.
  //
  // Skipped on the first run: the browser restores scroll position on back
  // navigation, and resetting on mount would throw that away — the very case
  // the mount-time sync() above exists to honour. Only a CHANGE of key means
  // the columns were swapped out underneath an established position.
  //
  // `scrollLeft = 0` rather than scrollTo({behavior:'smooth'}): the columns
  // underneath have already been replaced, so an animated slide would be
  // across content that no longer relates to where it started. The vertical
  // offset is left alone — the roster of people or work areas is the same
  // list, and an admin working down it keeps their place.
  const prevResetKey = useRef(resetKey)
  useEffect(() => {
    if (prevResetKey.current === resetKey) return
    prevResetKey.current = resetKey

    const el = ref.current
    if (!el) return
    el.scrollLeft = 0
    sync()
  }, [resetKey, sync])

  return { scrollRef: ref, isScrolled }
}
