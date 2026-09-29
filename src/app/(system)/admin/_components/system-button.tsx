'use client'

import { Button } from '@/components/ui/button'
import type { ButtonProps } from '@heroui/react'

// The primary button for the system-admin surface.
//
// `color="primary"` can't be used here: it resolves to --tenant-primary, and
// this layout renders no TenantThemeStyle, so on these pages that variable is
// undefined and the button comes out unpainted. The design shows graphite
// anyway — the system surface stands above every tenant and shouldn't borrow
// one tenant's branding — so the colour is fixed rather than themed.
export function SystemButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      className={`rounded-control bg-ink font-semibold text-white data-[hover=true]:opacity-100 hover:bg-ink-soft ${className ?? ''}`}
    />
  )
}
