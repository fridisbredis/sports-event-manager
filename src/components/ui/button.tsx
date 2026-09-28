'use client'

import { Button as HeroButton, type ButtonProps } from '@heroui/react'

// HeroUI's `bordered`/`faded`/`ghost` variants render a `border-medium` (2px)
// border by default. That reads as noticeably heavier than the 1px borders
// used elsewhere in the app (see WHITE_FIELD in form-fields.tsx), so it's
// thinned to `border-1` for those variants only. Other variants (solid,
// light, flat, shadow) don't set a border-color, so adding `border-1`
// unscoped would pick up Tailwind's preflight default and draw an unintended
// gray border on them.
const BORDERED_VARIANTS: ButtonProps['variant'][] = ['bordered', 'faded', 'ghost']

export function Button(props: ButtonProps) {
  const isBordered = BORDERED_VARIANTS.includes(props.variant)

  // HeroUI darkens solid buttons on hover with a blanket opacity change. The
  // design handoff instead specifies a distinct hover colour per theme
  // (--tenant-primary-hover), so solid primary buttons use that and opt out of
  // the opacity shift. Other variants and colours keep HeroUI's own behaviour.
  const isSolidPrimary =
    (props.variant ?? 'solid') === 'solid' && (props.color ?? 'default') === 'primary'

  const classes = [
    isBordered ? 'border-1' : '',
    isSolidPrimary
      ? 'rounded-control data-[hover=true]:opacity-100 hover:bg-tenant-primary-hover'
      : '',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return <HeroButton {...props} className={classes || undefined} />
}
