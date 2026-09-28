'use client'

import { AppCard } from '@/components/ui/app-card'

export function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <AppCard className={className}>{children}</AppCard>
}
