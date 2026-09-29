'use client'

// Facilities read as one sentence of plain text, dot-separated, rather than
// as chips. Chips imply something selectable or filterable; these are a
// static list of what exists on site. As tinted pills they also pulled more
// attention than the programme below them, which is the block officials
// actually come back to the screen for.
interface Facility {
  id: string
  label: string
}

export function FacilityChips({ facilities }: { facilities: Facility[] }) {
  return (
    <p className="text-[15px] leading-relaxed text-ink">
      {facilities.map((facility, i) => (
        <span key={facility.id}>
          {i > 0 ? <span className="text-ink-faint"> · </span> : null}
          {facility.label}
        </span>
      ))}
    </p>
  )
}
