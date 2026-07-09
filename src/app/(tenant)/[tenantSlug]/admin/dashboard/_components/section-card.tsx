'use client'

import { Card, CardBody } from '@heroui/react'

export function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardBody className="p-6">{children}</CardBody>
    </Card>
  )
}
