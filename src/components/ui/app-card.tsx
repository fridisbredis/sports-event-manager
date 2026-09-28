'use client'

import { Card, CardBody, type CardProps } from '@heroui/react'
import { CARD_SURFACE } from './card-styles'

// A thin wrapper around HeroUI's Card/CardBody so every "white panel on the
// gray admin background" in the app shares one shadow/radius/padding
// definition. Before this existed, panels were hand-built as
// `<div className="rounded-xl border border-gray-200 bg-white shadow-md">`,
// which drifted from HeroUI's own Card because Tailwind's shadow-md/rounded-xl
// are different values than HeroUI's design tokens of the same name. Always
// reach for this instead of a raw div.
//
// The surface itself now comes from CARD_SURFACE, which carries the design
// handoff's values. HeroUI's own shadow is switched off so it cannot stack on
// top of the one CARD_SURFACE sets.
export function AppCard({
  children,
  className,
  bodyClassName,
  ...props
}: CardProps & { bodyClassName?: string }) {
  return (
    <Card className={`${CARD_SURFACE} ${className ?? ''}`} shadow="none" {...props}>
      <CardBody className={bodyClassName ?? 'p-6'}>{children}</CardBody>
    </Card>
  )
}
