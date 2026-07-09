'use client'

import { Card, CardBody } from '@heroui/react'
import { BigStat } from './big-stat'

interface OfficialsCardProps {
  title: string
  invited: number
  invitedLabel: string
  confirmed: number
  confirmedLabel: string
}

export function OfficialsCard({ title, invited, invitedLabel, confirmed, confirmedLabel }: OfficialsCardProps) {
  return (
    <Card>
      <CardBody className="p-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{title}</h2>
        <div className="flex items-end gap-8">
          <BigStat value={invited} label={invitedLabel} />
          <BigStat value={confirmed} label={confirmedLabel} />
        </div>
      </CardBody>
    </Card>
  )
}
