'use client'

import { useTranslation } from '@/lib/i18n/client'
import type { UnsavedChangesDialogProps } from '@/lib/hooks/use-unsaved-changes'
import ConfirmDialog from '@/components/confirm-dialog'

export default function UnsavedChangesDialog({ open, onLeave, onStay }: UnsavedChangesDialogProps) {
  const { t } = useTranslation('common')

  return (
    <ConfirmDialog
      open={open}
      title={t('unsavedChanges.title')}
      body={t('unsavedChanges.body')}
      cancelLabel={t('actions.stayOnPage')}
      confirmLabel={t('actions.leaveAnyway')}
      onCancel={onStay}
      onConfirm={onLeave}
    />
  )
}
