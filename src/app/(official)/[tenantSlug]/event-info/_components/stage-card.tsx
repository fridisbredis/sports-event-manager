'use client'

import { Card, CardBody } from '@heroui/react'
import { CalendarIcon, ClockIcon, MapPinIcon } from './icons'

interface Props {
  stageNumber: number
  name: string
  date: string
  timeRange: string
  venue: string | null
}

export function StageCard({ stageNumber, name, date, timeRange, venue }: Props) {
  return (
    <Card shadow="sm">
      <CardBody className="p-4 flex-row gap-3">
        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
          {stageNumber}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {date ? (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <CalendarIcon />
                <span>{date}</span>
              </div>
            ) : null}
            {timeRange ? (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <ClockIcon />
                <span>{timeRange}</span>
              </div>
            ) : null}
            {venue ? (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPinIcon />
                <span>{venue}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
