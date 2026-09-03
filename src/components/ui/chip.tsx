'use client'

import { Chip as HeroChip, type ChipProps } from '@heroui/react'

// HeroUI's `bordered`/`faded` variants render a `border-medium` (2px) border
// by default, same as Button — see the Button wrapper for the full
// rationale. Thinned to `border-1` for those variants only.
const BORDERED_VARIANTS: ChipProps['variant'][] = ['bordered', 'faded']

export function Chip(props: ChipProps) {
  const isBordered = BORDERED_VARIANTS.includes(props.variant)
  return (
    <HeroChip
      {...props}
      className={isBordered ? `border-1 ${props.className ?? ''}` : props.className}
    />
  )
}
