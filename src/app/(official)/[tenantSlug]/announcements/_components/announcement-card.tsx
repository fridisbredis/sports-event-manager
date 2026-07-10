'use client'

import { Card, CardBody } from '@heroui/react'

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
    </svg>
  )
}

interface Props {
  time: string
  body: string
}

export function AnnouncementCard({ time, body }: Props) {
  return (
    <Card shadow="sm">
      <CardBody className="p-4 flex-row gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <BellIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{time}</p>
          <p className="text-sm text-gray-900 leading-relaxed mt-1">{body}</p>
        </div>
      </CardBody>
    </Card>
  )
}
