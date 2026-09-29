'use client'

import Image from 'next/image'
import { Chip, Divider } from '@heroui/react'
import { AppCard } from '@/components/ui/app-card'
import { LogoPlaceholder } from './icons'

interface Props {
  name: string
  eventType: string
  logoUrl: string | null
  description: string | null
}

export function EventHeaderCard({ name, eventType, logoUrl, description }: Props) {
  return (
    <AppCard className="mb-6" bodyClassName="gap-4 p-5">
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
          <p className="text-[19px] font-bold leading-snug text-ink">{name}</p>
          {eventType ? (
            <Chip
              size="sm"
              variant="flat"
              className="mt-1.5 bg-tenant-primary-tint capitalize font-medium text-tenant-primary-tint-text"
            >
              {eventType}
            </Chip>
          ) : null}
        </div>
      </div>
      {description ? (
        <>
          <Divider />
          <p className="text-[15px] leading-relaxed text-ink-muted">{description}</p>
        </>
      ) : null}
    </AppCard>
  )
}
