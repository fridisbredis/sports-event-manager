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
        <Chip key={facility.id} variant="flat" size="sm">
          {facility.label}
        </Chip>
      ))}
    </div>
  )
}
