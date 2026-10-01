'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseAutosaveOptions<T> {
  /**
   * Performs the write. Receives the most recent value queued at the moment the
   * timer fired, not the value that started it — a user who types three letters
   * inside the debounce window gets one request carrying the third.
   */
  onSave: (value: T) => Promise<void>
  /**
   * How long to wait after the last change before writing. Controls that cannot
   * produce an intermediate value worth skipping (a switch, a radio group) pass
   * 0 and write immediately.
   */
  delay?: number
  /** Called when a save fails, after the status has gone to 'error'. */
  onError?: (error: unknown) => void
}

/**
 * Debounced write-behind for a single field.
 *
 * Shaped around one rule: the last value the user expressed is the one that
 * must end up stored. Everything below follows from that — the queue holds a
 * value rather than a timer's closure, `flush` exists so blur and unmount can
 * overtake a pending timer, and a save that resolves while newer input is
 * already queued does not report 'saved'.
 *
 * It deliberately does not own the field's state. The caller keeps that, so the
 * input stays controlled and immediate; this hook only decides when what the
 * caller already has gets written.
 */
export function useAutosave<T>({ onSave, delay = 800, onError }: UseAutosaveOptions<T>) {
  const [status, setStatus] = useState<AutosaveStatus>('idle')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The value waiting to be written. Null-vs-set is the "is anything pending"
  // flag, which is why it is a box rather than a bare T — T itself may be null.
  const pending = useRef<{ value: T } | null>(null)
  // Bumped on every queue. A save compares the generation it started with
  // against this one before claiming success, so a slow request that lands
  // after the user has typed again cannot flash 'saved' for a stale value.
  const generation = useRef(0)
  const mounted = useRef(true)

  // Kept in refs so queue/flush stay stable across renders: the account form
  // passes inline closures, and a changing identity here would restart the
  // debounce timer on every keystroke-driven re-render.
  const onSaveRef = useRef(onSave)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onSaveRef.current = onSave
    onErrorRef.current = onError
  })

  const run = useCallback(async () => {
    const queued = pending.current
    if (!queued) return

    pending.current = null
    const startedAt = generation.current
    setStatus('saving')

    try {
      await onSaveRef.current(queued.value)
      if (!mounted.current) return
      // Newer input arrived while this was in flight. It has its own timer and
      // will report for itself; saying 'saved' here would describe the wrong
      // value.
      if (generation.current !== startedAt) return
      setStatus('saved')
    } catch (error) {
      if (!mounted.current) return
      setStatus('error')
      onErrorRef.current?.(error)
    }
  }, [])

  /** Queue a value. Resets the debounce window; writes immediately if delay is 0. */
  const queue = useCallback(
    (value: T) => {
      pending.current = { value }
      generation.current += 1
      setStatus('idle')

      if (timer.current) clearTimeout(timer.current)

      if (delay === 0) {
        void run()
        return
      }

      timer.current = setTimeout(() => {
        timer.current = null
        void run()
      }, delay)
    },
    [delay, run]
  )

  /**
   * Drop any pending value without writing it. For an edit that has returned to
   * what is already stored: declining to queue a new save is not enough on its
   * own, because an earlier keystroke's timer is still running and would write
   * the round trip out as a change.
   */
  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pending.current = null
    generation.current += 1
    setStatus('idle')
  }, [])

  /** Write any pending value now, cancelling the timer. Safe when nothing is pending. */
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!pending.current) return
    void run()
  }, [run])

  const hasPending = useCallback(() => pending.current !== null, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Fire-and-forget: the component is going away, but the user's last edit
      // should still reach the server. Nothing reads the status after this, so
      // the guards inside run() simply no-op.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        void run()
      }
    }
  }, [run])

  return { status, setStatus, queue, flush, cancel, hasPending }
}
