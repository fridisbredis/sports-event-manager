'use client'

import { Chip } from '@/components/ui/chip'

// Chips here are presentational only — nothing is selectable, filterable or
// removable. They are a static list of what exists on site, so they carry no
// close button and no interactive affordance.
//
// They share the admin editor's tenant primary tint (admin/event/_components/
// facilities-editor.tsx) but run larger here: the admin chips sit in a dense
// edit form, while this is a read-only mobile screen where the facilities are
// the content rather than a side effect of typing.
interface Facility {
  id: string
  label: string
}

export function FacilityChips({ facilities }: { facilities: Facility[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {facilities.map((facility) => (
        <li key={facility.id}>
          <Chip
            variant="flat"
            classNames={{
              // HeroUI sizes a chip by a fixed height plus horizontal padding
              // on the content, so both have to be overridden together: height
              // alone leaves the text cramped, padding alone gets clipped.
              base: 'h-auto bg-tenant-primary-tint px-1 py-1.5',
              content: 'px-2 text-base font-medium text-tenant-primary-tint-text',
            }}
          >
            {facility.label}
          </Chip>
        </li>
      ))}
    </ul>
  )
}
