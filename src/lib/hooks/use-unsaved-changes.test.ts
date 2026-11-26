import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { saveInTransition, useUnsavedChanges } from './use-unsaved-changes'
import { useRouter } from 'next/navigation'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

function mockRouter() {
  const push = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ push } as never)
  return { push }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useUnsavedChanges', () => {
  it('starts clean with the dialog closed', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    expect(result.current.isDirty).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('markDirty and markClean toggle isDirty', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.markDirty())
    expect(result.current.isDirty).toBe(true)

    act(() => result.current.markClean())
    expect(result.current.isDirty).toBe(false)
  })

  it('guardedNavigate pushes immediately when there are no unsaved changes', () => {
    const { push } = mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.guardedNavigate('/next'))

    expect(push).toHaveBeenCalledWith('/next')
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('guardedNavigate opens the dialog instead of navigating when dirty', () => {
    const { push } = mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.markDirty())
    act(() => result.current.guardedNavigate('/next'))

    expect(push).not.toHaveBeenCalled()
    expect(result.current.dialogProps.open).toBe(true)
  })

  it('onLeave navigates to the pending url, marks clean, and closes the dialog', () => {
    const { push } = mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.markDirty())
    act(() => result.current.guardedNavigate('/next'))
    act(() => result.current.dialogProps.onLeave())

    expect(push).toHaveBeenCalledWith('/next')
    expect(result.current.isDirty).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('onLeave runs onDiscard so the form can undo changes it made outside React state', () => {
    const { push } = mockRouter()
    const onDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChanges({ onDiscard }))

    act(() => result.current.markDirty())
    act(() => result.current.guardedNavigate('/next'))
    act(() => result.current.dialogProps.onLeave())

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith('/next')
  })

  it('onStay leaves the previewed changes in place', () => {
    mockRouter()
    const onDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChanges({ onDiscard }))

    act(() => result.current.markDirty())
    act(() => result.current.guardedNavigate('/next'))
    act(() => result.current.dialogProps.onStay())

    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('onLeave runs onDiscard for a back-navigation too', () => {
    mockRouter()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const onDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChanges({ onDiscard }))

    act(() => result.current.markDirty())
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    act(() => result.current.dialogProps.onLeave())

    expect(onDiscard).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('onStay closes the dialog without navigating or clearing the dirty flag', () => {
    const { push } = mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.markDirty())
    act(() => result.current.guardedNavigate('/next'))
    act(() => result.current.dialogProps.onStay())

    expect(push).not.toHaveBeenCalled()
    expect(result.current.isDirty).toBe(true)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('onLeave for a back-navigation calls history.back instead of router.push', () => {
    mockRouter()
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const { result } = renderHook(() => useUnsavedChanges())

    act(() => result.current.markDirty())
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    act(() => result.current.dialogProps.onLeave())

    expect(backSpy).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('warns before unload only while there are unsaved changes', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    const cleanEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    act(() => result.current.markDirty())

    const dirtyEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
  })

  it('intercepts a same-page anchor click while dirty and opens the dialog for that href', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())
    act(() => result.current.markDirty())

    const anchor = document.createElement('a')
    anchor.setAttribute('href', '/somewhere')
    document.body.appendChild(anchor)

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => anchor.dispatchEvent(clickEvent))

    expect(clickEvent.defaultPrevented).toBe(true)
    expect(result.current.dialogProps.open).toBe(true)

    document.body.removeChild(anchor)
  })

  it('does not intercept external, in-page, or mailto links', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())
    act(() => result.current.markDirty())

    for (const href of ['https://example.com', '#section', 'mailto:a@b.com']) {
      const anchor = document.createElement('a')
      anchor.setAttribute('href', href)
      document.body.appendChild(anchor)

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
      act(() => anchor.dispatchEvent(clickEvent))

      expect(clickEvent.defaultPrevented).toBe(false)
      document.body.removeChild(anchor)
    }

    expect(result.current.dialogProps.open).toBe(false)
  })

  it('does not intercept clicks while clean', () => {
    mockRouter()
    const { result } = renderHook(() => useUnsavedChanges())

    const anchor = document.createElement('a')
    anchor.setAttribute('href', '/somewhere')
    document.body.appendChild(anchor)

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(clickEvent)

    expect(clickEvent.defaultPrevented).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)

    document.body.removeChild(anchor)
  })

  describe('onSave', () => {
    it('offers no save in the dialog when the form passes no onSave', () => {
      mockRouter()
      const { result } = renderHook(() => useUnsavedChanges())

      expect(result.current.dialogProps.onSave).toBeUndefined()
    })

    it('continues the pending navigation once the save succeeds', async () => {
      const { push } = mockRouter()
      const onSave = vi.fn().mockResolvedValue(true)
      const onDiscard = vi.fn()
      const { result } = renderHook(() => useUnsavedChanges({ onSave, onDiscard }))

      act(() => result.current.markDirty())
      act(() => result.current.guardedNavigate('/next'))
      await act(async () => result.current.dialogProps.onSave!())

      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
      expect(push).toHaveBeenCalledWith('/next')
      expect(result.current.isDirty).toBe(false)
      expect(result.current.dialogProps.open).toBe(false)
      expect(result.current.dialogProps.isSaving).toBe(false)
    })

    it('continues a back-navigation once the save succeeds', async () => {
      mockRouter()
      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      const { result } = renderHook(() =>
        useUnsavedChanges({ onSave: vi.fn().mockResolvedValue(true) })
      )

      act(() => result.current.markDirty())
      act(() => {
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      await act(async () => result.current.dialogProps.onSave!())

      expect(backSpy).toHaveBeenCalledTimes(1)
      backSpy.mockRestore()
    })

    it('reports isSaving while the save runs', async () => {
      mockRouter()
      let finish: (saved: boolean) => void = () => {}
      const onSave = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
      const { result } = renderHook(() => useUnsavedChanges({ onSave }))

      act(() => result.current.markDirty())
      act(() => result.current.guardedNavigate('/next'))
      let pending: Promise<void> | undefined
      act(() => {
        pending = result.current.dialogProps.onSave!() as unknown as Promise<void>
      })
      expect(result.current.dialogProps.isSaving).toBe(true)

      await act(async () => {
        finish(true)
        await pending
      })
      expect(result.current.dialogProps.isSaving).toBe(false)
    })

    it('stays on the page, still dirty, when the save fails', async () => {
      const { push } = mockRouter()
      const { result } = renderHook(() =>
        useUnsavedChanges({ onSave: vi.fn().mockResolvedValue(false) })
      )

      act(() => result.current.markDirty())
      act(() => result.current.guardedNavigate('/next'))
      await act(async () => result.current.dialogProps.onSave!())

      expect(push).not.toHaveBeenCalled()
      expect(result.current.isDirty).toBe(true)
      expect(result.current.dialogProps.open).toBe(false)
    })

    it('treats a thrown save as failed instead of navigating away', async () => {
      const { push } = mockRouter()
      const { result } = renderHook(() =>
        useUnsavedChanges({ onSave: vi.fn().mockRejectedValue(new Error('boom')) })
      )

      act(() => result.current.markDirty())
      act(() => result.current.guardedNavigate('/next'))
      await act(async () => result.current.dialogProps.onSave!())

      expect(push).not.toHaveBeenCalled()
      expect(result.current.dialogProps.open).toBe(false)
      expect(result.current.dialogProps.isSaving).toBe(false)
    })

    it('does not carry a failed save’s navigation over to a later leave', async () => {
      const { push } = mockRouter()
      const { result } = renderHook(() =>
        useUnsavedChanges({ onSave: vi.fn().mockResolvedValue(false) })
      )

      act(() => result.current.markDirty())
      act(() => result.current.guardedNavigate('/first'))
      await act(async () => result.current.dialogProps.onSave!())
      act(() => result.current.guardedNavigate('/second'))
      act(() => result.current.dialogProps.onLeave())

      expect(push).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledWith('/second')
    })
  })
})

describe('saveInTransition', () => {
  const runNow = ((cb: () => unknown) => {
    void cb()
  }) as never

  it('resolves with what the save returned', async () => {
    await expect(saveInTransition(runNow, async () => true)).resolves.toBe(true)
    await expect(saveInTransition(runNow, async () => false)).resolves.toBe(false)
  })

  it('resolves false when the save throws, so the dialog does not wait forever', async () => {
    let rethrown: unknown
    const capture = ((cb: () => Promise<unknown>) => {
      cb().catch((e) => (rethrown = e))
    }) as never

    await expect(
      saveInTransition(capture, async () => {
        throw new Error('boom')
      })
    ).resolves.toBe(false)
    await Promise.resolve()
    expect(rethrown).toBeInstanceOf(Error)
  })
})
