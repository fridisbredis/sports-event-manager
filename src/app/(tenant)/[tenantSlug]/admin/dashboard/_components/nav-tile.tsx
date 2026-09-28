'use client'

import Link from 'next/link'
import { Card, CardBody } from '@heroui/react'
import { CARD_SURFACE } from '@/components/ui/card-styles'

export function NavTile({ href, title }: { href: string; title: string }) {
  return (
    // Quick-link tiles lift slightly on hover and take the theme colour, per
    // the design handoff — the one place cards are interactive.
    <Card
      as={Link}
      href={href}
      isPressable
      shadow="none"
      className={`${CARD_SURFACE} w-full transition-all hover:-translate-y-px hover:border-tenant-primary hover:text-tenant-primary-tint-text`}
    >
      <CardBody className="flex-row items-center justify-between px-5 py-4">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-tenant-primary">›</span>
      </CardBody>
    </Card>
  )
}
