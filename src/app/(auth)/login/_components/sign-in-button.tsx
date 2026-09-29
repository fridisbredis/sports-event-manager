'use client'

import { Button } from '@/components/ui/button'
import type { ButtonProps } from '@heroui/react'

// The primary action on the sign-in screen, in the same graphite as the
// system-admin surface (see SystemButton). `color="primary"` can't be used:
// it resolves to --tenant-primary, and sign-in happens before a tenant is
// known, so this route renders no TenantThemeStyle and the variable is
// undefined — the button would come out unpainted.
//
// `rounded-full` rather than the `rounded-control` used elsewhere: the design
// draws this one as a pill, which is what marks it as the single committing
// action on an otherwise near-empty screen.
export function SignInButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      className={`h-14 rounded-full bg-ink text-base font-semibold text-white data-[hover=true]:opacity-100 hover:bg-ink-soft ${className ?? ''}`}
    />
  )
}
