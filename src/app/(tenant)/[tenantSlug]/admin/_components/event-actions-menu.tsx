'use client'

import { useState, useTransition } from 'react'
import { Archive, ArchiveRestore, MoreHorizontal } from 'lucide-react'
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react'
import ConfirmDialog from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { LISTBOX_ITEM } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { setEventArchived } from '@/lib/actions/set-event-archived'

// The card's rarely used actions, out of the way behind a ⋯ so they never
// compete with the event itself.
//
// Archiving is confirmed first: it locks the event for editing and takes it
// off the officials' event list. Un-archiving is not — it only brings the
// event back as a draft, and the server refuses it when no slot is free.
export function EventActionsMenu({
  tenantSlug,
  eventId,
  eventName,
  isArchived,
}: {
  tenantSlug: string
  eventId: string
  eventName: string
  isArchived: boolean
}) {
  const { t } = useTranslation('admin')
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()

  function run(archived: boolean) {
    setConfirming(false)
    startTransition(async () => {
      const result = await setEventArchived({ tenantSlug, eventId, archived })
      if (result.error) toastError(result.error)
    })
  }

  const label = t('events.actionsFor', { name: eventName })

  return (
    <>
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <Button isIconOnly variant="light" size="sm" isLoading={isPending} aria-label={label}>
            <MoreHorizontal className="size-5 text-ink-soft" aria-hidden />
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={label}
          itemClasses={{ base: LISTBOX_ITEM }}
          onAction={(key) => {
            if (key === 'unarchive') run(false)
            else if (key === 'archive') setConfirming(true)
          }}
        >
          {isArchived ? (
            <DropdownItem
              key="unarchive"
              startContent={<ArchiveRestore className="size-4" strokeWidth={1.75} aria-hidden />}
            >
              {t('events.unarchive')}
            </DropdownItem>
          ) : (
            <DropdownItem
              key="archive"
              className="text-destructive"
              color="danger"
              startContent={<Archive className="size-4" strokeWidth={1.75} aria-hidden />}
            >
              {t('events.archive')}
            </DropdownItem>
          )}
        </DropdownMenu>
      </Dropdown>
      <ConfirmDialog
        open={confirming}
        title={t('events.archiveConfirmTitle', { name: eventName })}
        body={t('events.archiveConfirmBody')}
        cancelLabel={t('events.cancel')}
        confirmLabel={t('events.archive')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => run(true)}
        destructive
      />
    </>
  )
}
