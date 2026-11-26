'use client'

import { useTranslation } from '@/lib/i18n/client'
import type { UnsavedChangesDialogProps } from '@/lib/hooks/use-unsaved-changes'
import ConfirmDialog from '@/components/confirm-dialog'

export default function UnsavedChangesDialog({
  open,
  onLeave,
  onStay,
  onSave,
  isSaving,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation('common')

  // With a save handler the choice is Save or Leave anyway; closing the dialog
  // (X, Esc, outside click) is how the user stays. Without one, the dialog
  // falls back to Stay or Leave anyway.
  if (onSave) {
    return (
      <ConfirmDialog
        open={open}
        title={t('unsavedChanges.title')}
        body={t('unsavedChanges.body')}
        cancelLabel={t('actions.leaveAnyway')}
        confirmLabel={t('actions.save')}
        onCancel={onLeave}
        onDismiss={onStay}
        onConfirm={onSave}
        isPending={isSaving}
      />
    )
  }

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
