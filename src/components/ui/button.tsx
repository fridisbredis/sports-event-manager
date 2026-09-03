'use client'

import { Button as HeroButton, type ButtonProps } from '@heroui/react'

// HeroUI's `bordered` variant renders a `border-medium` (2px) border by
// default. That reads as noticeably heavier than the 1px borders used
// elsewhere in the app (see WHITE_FIELD in form-fields.tsx), so it's thinned
// here to `border-1` for every variant — a no-op for variants that don't
// render a border (solid, light, ...).
const THIN_BORDER = 'border-1'

export function Button(props: ButtonProps) {
  return <HeroButton {...props} className={`${THIN_BORDER} ${props.className ?? ''}`} />
}
