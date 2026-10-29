'use client'

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
