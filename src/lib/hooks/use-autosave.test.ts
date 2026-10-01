import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutosave } from './use-autosave'

describe('useAutosave', () => {
  beforeEach(() => {
    // Installed before any render, so every timer the hook creates belongs to
    // the fake clock rather than the real one.
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits out the delay before writing', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('a'))
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of changes into one write carrying the last value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('F'))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.queue('Fr'))
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.queue('Fri'))

    // Each queue restarted the window, so nothing has been written 600ms in.
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Fri')
  })

  it('writes immediately when the delay is zero', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<boolean>({ onSave, delay: 0 }))

    await act(async () => {
      result.current.queue(true)
    })

    expect(onSave).toHaveBeenCalledWith(true)
  })

  it('flush overtakes a pending timer', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('a'))
    await act(async () => {
      result.current.flush()
    })

    expect(onSave).toHaveBeenCalledTimes(1)

    // The cancelled timer must not fire a second write afterwards.
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('flush does nothing when there is no pending value', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    await act(async () => {
      result.current.flush()
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('reports saved on success and error on failure', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 0 }))

    await act(async () => {
      result.current.queue('a')
    })
    expect(result.current.status).toBe('saved')

    const failingSave = vi.fn().mockRejectedValue(new Error('boom'))
    const onError = vi.fn()
    const { result: failing } = renderHook(() =>
      useAutosave<string>({ onSave: failingSave, delay: 0, onError })
    )

    await act(async () => {
      failing.current.queue('b')
    })

    expect(failing.current.status).toBe('error')
    expect(onError).toHaveBeenCalled()
  })

  it('does not report saved for a value the user has already typed past', async () => {
    // A slow write is still in flight when the user types again. The late
    // response must not announce "Saved", because what it saved is no longer
    // what the field shows — the newer value has its own timer still pending,
    // so nothing has been stored for it yet.
    let release: (() => void) | undefined
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('first'))
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(result.current.status).toBe('saving')

    // Newer input arrives before the first write resolves. Its own debounce
    // window has not elapsed, so no second request has gone out yet.
    act(() => result.current.queue('second'))
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      release?.()
    })

    expect(result.current.status).not.toBe('saved')
  })

  it('cancel retracts a write that is still only pending', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('a'))
    act(() => result.current.cancel())

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(onSave).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })

  it('writes a pending value when the component unmounts', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() => useAutosave<string>({ onSave, delay: 800 }))

    act(() => result.current.queue('a'))
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      unmount()
    })

    expect(onSave).toHaveBeenCalledWith('a')
  })
})
