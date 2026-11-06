'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

interface PublishButtonProps {
  disabled?: boolean
  loading?: boolean
  type?: 'submit' | 'button'
  children: React.ReactNode
}

export function PublishButton({
  disabled,
  loading,
  type = 'submit',
  children,
}: PublishButtonProps) {
  return (
    <Button type={type} color="primary" isDisabled={disabled} isLoading={loading}>
      {children}
    </Button>
  )
}

// Unpublish is the quieter action: it closes the participant side for a
// while, so it reads as secondary rather than as the card's primary call.
// Pending state comes from the enclosing <form action>.
export function UnpublishButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="bordered"
      isDisabled={pending}
      isLoading={pending}
      className="rounded-control border-edge-field bg-white"
    >
      {children}
    </Button>
  )
}
