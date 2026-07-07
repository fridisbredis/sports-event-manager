'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'

interface OperatingWindow {
  window_start: string
  window_end: string
}

interface Stage {
  id: string
  name: string
  stage_type: string
  start_time: string | null
  end_time: string | null
}

interface Workstation {
  id: string
  name: string
  capacity_ceiling: number
  stage_id: string | null
  workstation_operating_windows: OperatingWindow[]
}

interface Props {
  tenantSlug: string
  stages: Stage[]
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

function formatStageDate(stage: Stage): string {
  if (!stage.start_time) return ''
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }
  const start = new Date(stage.start_time).toLocaleDateString('en-GB', opts)
  if (!stage.end_time) return start
  const startDay = utcDateStr(stage.start_time)
  const endDay = utcDateStr(stage.end_time)
  if (startDay === endDay) {
    const startTime = utcTimeStr(stage.start_time)
    const endTime = utcTimeStr(stage.end_time)
    return `${start} · ${startTime}–${endTime}`
  }
  const end = new Date(stage.end_time).toLocaleDateString('en-GB', opts)
  return `${start} – ${end}`
}

function StageSection({
  stage,
  workstations,
  tenantSlug,
}: {
  stage: Stage
  workstations: Workstation[]
  tenantSlug: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const router = useRouter()
  const { t } = useTranslation('admin')

  const typeLabel = stage.stage_type === 'race'
    ? t('eventConfig.stageTypeRace')
    : t('eventConfig.stageTypeNonRace')

  const dateStr = formatStageDate(stage)
  const count = workstations.length

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Stage header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <svg
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="4 6 8 10 12 6" />
        </svg>
        <span className="font-medium text-gray-900 text-sm">{stage.name}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            stage.stage_type === 'race'
              ? 'bg-blue-50 text-blue-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {typeLabel}
        </span>
        {dateStr && (
          <span className="text-xs text-gray-400">{dateStr}</span>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {t('workstations.workAreaCount', { count })}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100">
          {count > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t('workstations.nameLabel')}
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t('workstations.colOperatingWindows')}
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t('workstations.colCapacity')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {workstations.map((ws) => {
                  const windows = ws.workstation_operating_windows ?? []
                  return (
                    <tr
                      key={ws.id}
                      onClick={() => router.push(`/${tenantSlug}/admin/workstations/${ws.id}`)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="px-5 py-3 font-medium text-gray-900">{ws.name}</td>
                      <td className="px-5 py-3 text-gray-600">{formatWindowsSummary(windows)}</td>
                      <td className="px-5 py-3 text-gray-600">
                        {t('workstations.upTo', { n: ws.capacity_ceiling })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="px-5 py-3.5">
            <button
              onClick={() => router.push(`/${tenantSlug}/admin/workstations/new?stageId=${stage.id}`)}
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              + {t('workstations.addWorkArea')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkstationsList({ tenantSlug, stages, workstations }: Props) {
  const router = useRouter()
  const { t } = useTranslation('admin')

  if (stages.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">{t('workstations.title')}</h1>
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
          <p className="text-base font-medium text-gray-900 mb-1">{t('workstations.noStages')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('workstations.noStagesHint')}</p>
          <button
            onClick={() => router.push(`/${tenantSlug}/admin/event`)}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('workstations.goToEventConfig')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">{t('workstations.title')}</h1>
      <div className="space-y-4">
        {stages.map((stage) => (
          <StageSection
            key={stage.id}
            stage={stage}
            workstations={workstations.filter((ws) => ws.stage_id === stage.id)}
            tenantSlug={tenantSlug}
          />
        ))}
      </div>
    </div>
  )
}
