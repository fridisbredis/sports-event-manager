'use client'

import Link from 'next/link'
import { Card, CardBody, Chip, Button } from '@heroui/react'
import { BigStat } from './big-stat'

interface SchedulingWarningsCardProps {
  title: string
  overCapacity: number
  overCapacityLabel: string
  doubleBooked: number
  doubleBookedLabel: string
  allClearLabel: string
  issuesLabel: string
  reviewHref: string
  reviewLabel: string
}

export function SchedulingWarningsCard({
  title,
  overCapacity,
  overCapacityLabel,
  doubleBooked,
  doubleBookedLabel,
  allClearLabel,
  issuesLabel,
  reviewHref,
  reviewLabel,
}: SchedulingWarningsCardProps) {
  const totalWarnings = overCapacity + doubleBooked

  return (
    <Card>
      <CardBody className="p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</h2>
          <Chip size="sm" variant={totalWarnings === 0 ? 'bordered' : 'flat'} color={totalWarnings === 0 ? 'default' : 'warning'}>
            {totalWarnings === 0 ? allClearLabel : issuesLabel}
          </Chip>
        </div>
        <div className="flex items-end gap-8">
          <BigStat value={overCapacity} label={overCapacityLabel} />
          <BigStat value={doubleBooked} label={doubleBookedLabel} />
        </div>
        {totalWarnings > 0 && (
          <div className="mt-5">
            <Button as={Link} href={reviewHref} variant="bordered">
              {reviewLabel}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
