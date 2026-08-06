import { useTranslation } from '@/lib/i18n/client'

export function SetupEmptyState() {
  const { t } = useTranslation('admin')
  return (
    <div className="border border-gray-200 rounded-md bg-white py-16 flex flex-col items-center gap-3">
      <div className="w-16 h-16 border-2 border-gray-300 rounded-md flex items-center justify-center">
        <svg
          className="w-8 h-8 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 20L20 4M4 4l16 16"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">{t('scheduling.noAssignmentsTitle')}</p>
      <p className="text-sm text-gray-500 text-center max-w-xs">
        {t('scheduling.noAssignmentsHint')}
      </p>
    </div>
  )
}
