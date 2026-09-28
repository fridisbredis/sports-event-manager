'use client'

import { Chip } from '@heroui/react'

interface Facility {
  id: string
  label: string
}

export function FacilityChips({ facilities }: { facilities: Facility[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {facilities.map((facility) => (
        <Chip
          key={facility.id}
          variant="flat"
          size="sm"
          className="bg-tenant-primary-tint font-medium text-tenant-primary-tint-text"
        >
          {facility.label}
        </Chip>
      ))}
    </div>
  )
}
