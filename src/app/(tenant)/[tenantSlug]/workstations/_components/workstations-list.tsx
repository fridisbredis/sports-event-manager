'use client'

import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'

interface OperatingWindow {
  window_start: string
  window_end: string
}

interface Stage {
  name: string
  stage_type: string
}

interface Workstation {
  id: string
  name: string
  capacity_ceiling: number
  stage_id: string | null
  event_stages: Stage | null
  workstation_operating_windows: OperatingWindow[]
}

interface Props {
  tenantSlug: string
  workstations: Workstation[]
}

function utcDateStr(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function utcTimeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

function formatWindow(w: OperatingWindow): string {
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

  const startDay = utcDateStr(w.window_start)
  const endDay = utcDateStr(w.window_end)
  const startTime = utcTimeStr(w.window_start)
  const endTime = utcTimeStr(w.window_end)

  if (startDay !== endDay) {
    return `${dateLabel(w.window_start)} · ${startTime} – ${dateLabel(w.window_end)} · ${endTime}`
  }
  return `${dateLabel(w.window_start)} · ${startTime}–${endTime}`
}

function formatWindowsSummary(windows: OperatingWindow[]): string {
  if (windows.length === 0) return '—'
  if (windows.length === 1) return formatWindow(windows[0])

  const days = new Set(windows.map((w) => utcDateStr(w.window_start)))
  const slots = new Set(windows.map((w) => `${utcTimeStr(w.window_start)}–${utcTimeStr(w.window_end)}`))

  if (windows.length === days.size * slots.size) {
    const slotList = [...slots].join(', ')
    return days.size === 1 ? slotList : `${slotList} · ${days.size} days`
  }

  return `${formatWindow(windows[0])} +${windows.length - 1}`
}

export default function WorkstationsList({ tenantSlug, workstations }: Props) {
  const router = useRouter()
  const { t } = useTranslation('admin')

  function stageLabel(ws: Workstation): string {
    if (!ws.event_stages) return t('workstations.allStages')
    const typeStr = ws.event_stages.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')
    return `${ws.event_stages.name} · ${typeStr}`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('workstations.title')}</h1>
        <button
          onClick={() => router.push(`/${tenantSlug}/workstations/new`)}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
        >
          {t('workstations.addWorkArea')}
        </button>
      </div>

      {workstations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
          <svg
            className="mb-4 h-12 w-12 text-gray-300"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="8" y="8" width="32" height="32" rx="2" />
            <line x1="8" y1="8" x2="40" y2="40" />
            <line x1="40" y1="8" x2="8" y2="40" />
          </svg>
          <p className="text-base font-medium text-gray-900 mb-1">{t('workstations.empty')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('workstations.emptyHint')}</p>
          <button
            onClick={() => router.push(`/${tenantSlug}/workstations/new`)}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            {t('workstations.addWorkArea')}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('workstations.nameLabel')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('workstations.colStage')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('workstations.colOperatingWindows')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t('workstations.colCapacity')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {workstations.map((ws) => {
                const windows = ws.workstation_operating_windows ?? []
                const windowLabel = formatWindowsSummary(windows)

                return (
                  <tr
                    key={ws.id}
                    onClick={() => router.push(`/${tenantSlug}/workstations/${ws.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{ws.name}</td>
                    <td className="px-4 py-3 text-gray-600">{stageLabel(ws)}</td>
                    <td className="px-4 py-3 text-gray-600">{windowLabel}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {t('workstations.upTo', { n: ws.capacity_ceiling })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
