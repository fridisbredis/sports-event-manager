import { useEffect, useState } from 'react'

/**
 * Whether a surface opened mid-gesture may act on clicks yet.
 *
 * A drag-to-paint gesture opens its picker from its own `pointerup`, so the
 * browser then delivers that same release as a `click` to whatever now sits
 * under the pointer — a row of the freshly mounted list. That picked an
 * option the instant the drag ended, which reads as the picker ignoring the
 * click that follows.
 *
 * The guard is a capture-phase `click` listener that swallows exactly one
 * event, rather than a timer: the surface animates in, so how long the stray
 * click takes to arrive is not something a frame count or a delay can
 * predict — but it is always the very next click, and a deliberate one can
 * only come after it.
 *
 * @param openedMidGesture Whether the pointer was still down when this
 *   surface mounted. A surface opened by an ordinary click is already past
 *   the release that opened it, so it must arm immediately — swallowing a
 *   click there would eat the user's next real one.
 */
export function useArmedAfterGesture(openedMidGesture: boolean): boolean {
  const [armed, setArmed] = useState(!openedMidGesture)

  useEffect(() => {
    if (!openedMidGesture) return

    // Capture phase, so this runs before the click reaches a row's handler
    // and can stop it from getting there at all.
    function swallow(e: MouseEvent) {
      e.stopPropagation()
      e.preventDefault()
      setArmed(true)
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    return () => window.removeEventListener('click', swallow, { capture: true })
    // Intentionally mount-only: `openedMidGesture` describes how this surface
    // came to exist, which cannot change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return armed
}
