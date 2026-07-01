'use client'

import { createPortal } from 'react-dom'
import { useTranslation } from '@/lib/i18n/client'
import type { UnsavedChangesDialogProps } from '@/lib/hooks/use-unsaved-changes'

export default function UnsavedChangesDialog({ open, onLeave, onStay }: UnsavedChangesDialogProps) {
  const { t } = useTranslation('common')

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="px-6 pt-6 pb-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            {t('unsavedChanges.title')}
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            {t('unsavedChanges.body')}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onStay}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            {t('actions.stayOnPage')}
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            {t('actions.leaveAnyway')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
