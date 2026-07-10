'use client'

import Image from 'next/image'
import { Card, CardBody, Chip, Divider } from '@heroui/react'
import { LogoPlaceholder } from './icons'

interface Props {
  name: string
  eventType: string
  logoUrl: string | null
  description: string | null
}

export function EventHeaderCard({ name, eventType, logoUrl, description }: Props) {
  return (
    <Card className="mb-6" shadow="sm">
      <CardBody className="gap-4 p-5">
        <div className="flex items-start gap-4">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt={name}
              width={64}
              height={64}
              className="rounded-lg object-cover shrink-0"
            />
          ) : (
            <LogoPlaceholder size={64} />
          )}
          <div className="min-w-0 pt-0.5">
            <p className="text-lg font-bold text-gray-900 leading-snug">{name}</p>
            {eventType ? (
              <Chip size="sm" color="primary" variant="flat" className="mt-1.5 capitalize">
                {eventType}
              </Chip>
            ) : null}
          </div>
        </div>
        {description ? (
          <>
            <Divider />
            <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}
