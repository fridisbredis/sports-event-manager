'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

type PendingNavigation =
  | { type: 'push'; url: string }
  | { type: 'back' }
  | null

export interface UnsavedChangesDialogProps {
  open: boolean
  onLeave: () => void
  onStay: () => void
}

export function useUnsavedChanges() {
  const router = useRouter()
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(false)

  const [dialogOpen, setDialogOpen] = useState(false)
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

  const handleLeave = useCallback(() => {
    const pending = pendingNav.current
    pendingNav.current = null
    setDialogOpen(false)
    markClean()
    if (pending?.type === 'push') router.push(pending.url)
    else if (pending?.type === 'back') window.history.back()
  }, [markClean, router])

  const handleStay = useCallback(() => {
    pendingNav.current = null
    setDialogOpen(false)
  }, [])

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
      if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return
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
  }

  return { isDirty, markDirty, markClean, guardedNavigate, dialogProps }
}
