import { useTranslation } from '@/lib/i18n/client'
import type { SchedulingView } from './scheduling-types'

// A segmented control rather than two separate buttons: the two views are one
// either/or choice, and the shared track makes that read at a glance. Plain
// <button>s, not our Button, because HeroUI's own padding and min-width fight
// the flush segments.
export function SchedulingViewToggle({
  view,
  onChange,
}: {
  view: SchedulingView
  onChange: (view: SchedulingView) => void
}) {
  const { t } = useTranslation('admin')
  const options = [
    ['by-person', t('scheduling.viewByPerson')],
    ['by-work-area', t('scheduling.viewByWorkArea')],
  ] as const

  return (
    <div
      role="tablist"
      aria-label={t('scheduling.viewToggleLabel')}
      className="no-print mb-5 inline-flex gap-1 rounded-control bg-status-neutral-bg p-1"
    >
      {options.map(([key, label]) => {
        const isActive = view === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={`rounded-[7px] px-4 py-1.5 text-sm font-semibold transition-colors ${
              isActive ? 'bg-tenant-primary text-white shadow-card' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
