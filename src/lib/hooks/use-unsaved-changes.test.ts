import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUnsavedChanges } from './use-unsaved-changes'
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
})
