'use client'

import Link from 'next/link'
import { Card, CardBody } from '@heroui/react'

export function NavTile({ href, title }: { href: string; title: string }) {
  return (
    <Card as={Link} href={href} isPressable className="w-full">
      <CardBody className="flex-row items-center justify-between px-5 py-4">
        <span className="text-sm font-medium text-gray-900">{title}</span>
        <span className="text-gray-400">›</span>
      </CardBody>
    </Card>
  )
}
