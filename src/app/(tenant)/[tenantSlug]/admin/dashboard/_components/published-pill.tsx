'use client'

import { Chip } from '@heroui/react'

export function PublishedPill({
  isPublished,
  publishedString,
  unpublishedString,
}: {
  isPublished: boolean
  publishedString?: string
  unpublishedString?: string
}) {
  return (
    <Chip color={isPublished ? 'success' : 'default'} variant="flat">
      {isPublished ? publishedString || 'Published' : unpublishedString || 'Unpublished'}
    </Chip>
  )
}
