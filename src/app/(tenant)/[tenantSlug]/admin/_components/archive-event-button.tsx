'use client'

import { useState, useTransition } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import ConfirmDialog from '@/components/confirm-dialog'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { setEventArchived } from '@/lib/actions/set-event-archived'

// Archiving is confirmed first: it locks the event for editing and takes it
// off the officials' event list. Un-archiving is not — it only brings the
// event back as a draft, and the server refuses it when no slot is free.
export function ArchiveEventButton({
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

  if (isArchived) {
    return (
      <LinkButton isDisabled={isPending} onPress={() => run(false)}>
        <ArchiveRestore className="size-4" strokeWidth={1.75} aria-hidden />
        {t('events.unarchive')}
      </LinkButton>
    )
  }

  return (
    <>
      <LinkButton tone="danger" isDisabled={isPending} onPress={() => setConfirming(true)}>
        <Archive className="size-4" strokeWidth={1.75} aria-hidden />
        {t('events.archive')}
      </LinkButton>
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
