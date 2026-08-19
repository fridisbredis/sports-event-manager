'use client'

import { useState, type ReactNode } from 'react'
import { toastError } from '@/lib/toast'

interface Props {
  className?: string
  title?: string
  children: ReactNode
}

export function LogoutButton({ className, title, children }: Props) {
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Posting to the server route rather than calling supabase.auth.signOut()
  // here: only the server owns the cookie jar and can delete the sb-* cookies
  // unconditionally, even if the provider call itself fails.
  async function handleLogout() {
    setIsSigningOut(true)
    try {
      const response = await fetch('/api/auth/signout', { method: 'POST' })
      if (!response.ok) {
        toastError('Could not sign out. Please try again.')
        setIsSigningOut(false)
        return
      }
      // Hard navigation, not router.push: discards the client Router Cache
      // and replaces the current history entry.
      window.location.replace('/login')
    } catch {
      toastError('Could not sign out. Please try again.')
      setIsSigningOut(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isSigningOut}
      className={className}
      title={title}
    >
      {children}
    </button>
  )
}
