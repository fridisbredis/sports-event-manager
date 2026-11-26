'use client'

import { useState, useEffect, useRef, useCallback, type TransitionStartFunction } from 'react'
import { useRouter } from 'next/navigation'

type PendingNavigation = { type: 'push'; url: string } | { type: 'back' } | null

export interface UnsavedChangesDialogProps {
  open: boolean
  onLeave: () => void
  onStay: () => void
  /** Present when the form passed `onSave`: the dialog then offers Save instead of Stay. */
  onSave?: () => void
  isSaving: boolean
}

export interface UseUnsavedChangesOptions {
  /**
   * Undo anything the form changed outside its own React state — DOM the form
   * mutated directly, for instance — when the user chooses to leave. State held
   * in the component goes away with the unmount and needs nothing here; a
   * mutation written straight to the document survives the navigation and would
   * otherwise look like it had been saved.
   */
  onDiscard?: () => void
  /**
   * Save the form from the dialog. Resolve true when the save went through —
   * the navigation the user started then continues — and false when it did
   * not, which closes the dialog and leaves the user on the page with the
   * form's own error showing.
   */
  onSave?: () => Promise<boolean>
}

/**
 * Run a form's save inside its own transition and resolve with the outcome,
 * so the dialog's Save and the page's Save button share one pending state.
 * A throw resolves false first — the dialog must not wait forever — and is
 * then rethrown, which keeps the transition's usual error handling.
 */
export function saveInTransition(
  startTransition: TransitionStartFunction,
  save: () => Promise<boolean>
): Promise<boolean> {
  return new Promise((resolve) => {
    startTransition(async () => {
      try {
        resolve(await save())
      } catch (error) {
        resolve(false)
        throw error
      }
    })
  })
}

export function useUnsavedChanges({ onDiscard, onSave }: UseUnsavedChangesOptions = {}) {
  const router = useRouter()
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(false)

  // Held in a ref so callers can pass an inline closure without giving
  // handleLeave a new identity on every render.
  const onDiscardRef = useRef(onDiscard)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onDiscardRef.current = onDiscard
    onSaveRef.current = onSave
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const pendingNav = useRef<PendingNavigation>(null)

  const markDirty = useCallback(() => {
    isDirtyRef.current = true
    setIsDirty(true)
  }, [])

  const markClean = useCallback(() => {
    isDirtyRef.current = false
    setIsDirty(false)
  }, [])

  const openDialog = useCallback((pending: PendingNavigation) => {
    pendingNav.current = pending
    setDialogOpen(true)
  }, [])

  const continuePending = useCallback(() => {
    const pending = pendingNav.current
    pendingNav.current = null
    setDialogOpen(false)
    markClean()
    if (pending?.type === 'push') router.push(pending.url)
    else if (pending?.type === 'back') window.history.back()
  }, [markClean, router])

  const handleLeave = useCallback(() => {
    onDiscardRef.current?.()
    continuePending()
  }, [continuePending])

  const handleStay = useCallback(() => {
    pendingNav.current = null
    setDialogOpen(false)
  }, [])

  const handleSave = useCallback(async () => {
    const save = onSaveRef.current
    if (!save) return
    setIsSaving(true)
    let saved = false
    try {
      saved = await save()
    } catch {
      // A thrown server action is a failed save like any other: stay on the
      // page rather than navigate away from changes that never landed.
      saved = false
    } finally {
      setIsSaving(false)
    }
    if (saved) continuePending()
    else handleStay()
  }, [continuePending, handleStay])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (!isDirty) return

    const handleClick = (e: MouseEvent) => {
      if (!isDirtyRef.current) return
      const anchor = (e.target as Element).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:'))
        return
      e.preventDefault()
      e.stopImmediatePropagation()
      openDialog({ type: 'push', url: href })
    }

    const savedUrl = window.location.href
    const handlePopState = () => {
      window.history.pushState(null, '', savedUrl)
      openDialog({ type: 'back' })
    }

    document.addEventListener('click', handleClick, { capture: true })
    window.addEventListener('popstate', handlePopState)

    return () => {
      document.removeEventListener('click', handleClick, { capture: true })
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isDirty, openDialog])

  const guardedNavigate = useCallback(
    (url: string) => {
      if (!isDirtyRef.current) {
        router.push(url)
      } else {
        openDialog({ type: 'push', url })
      }
    },
    [openDialog, router]
  )

  const dialogProps: UnsavedChangesDialogProps = {
    open: dialogOpen,
    onLeave: handleLeave,
    onStay: handleStay,
    onSave: onSave ? handleSave : undefined,
    isSaving,
  }

  return { isDirty, markDirty, markClean, guardedNavigate, dialogProps }
}
