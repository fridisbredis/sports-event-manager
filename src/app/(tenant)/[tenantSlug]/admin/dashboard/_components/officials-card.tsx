'use client'

import { AppCard } from '@/components/ui/app-card'
import { BigStat } from './big-stat'

interface OfficialsCardProps {
  title: string
  invited: number
  invitedLabel: string
  confirmed: number
  confirmedLabel: string
}

export function OfficialsCard({
  title,
  invited,
  invitedLabel,
  confirmed,
  confirmedLabel,
}: OfficialsCardProps) {
  return (
    <AppCard className="card-accent-primary">
      <h2 className="section-label mb-4">{title}</h2>
      <div className="flex items-end gap-8">
        <BigStat value={invited} label={invitedLabel} />
        <BigStat value={confirmed} label={confirmedLabel} emphasis />
      </div>
    </AppCard>
  )
}
