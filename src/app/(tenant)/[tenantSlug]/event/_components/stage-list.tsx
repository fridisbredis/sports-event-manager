'use client'

import { useState } from 'react'
import type { StageInput } from '../actions'
import StageModal from './stage-modal'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  stages: StageInput[]
  onChange: (stages: StageInput[]) => void
  categoryType: 'distance' | 'time'
  onCategoryTypeChange: (type: 'distance' | 'time') => void
}

const DEFAULT_STAGES: StageInput[] = [
  { name: 'Setup', stage_type: 'non_race', start_time: null, end_time: null, venue: '', position: 0, distances: [] },
  { name: 'Race', stage_type: 'race', start_time: null, end_time: null, venue: '', position: 1, distances: [] },
  { name: 'Teardown', stage_type: 'non_race', start_time: null, end_time: null, venue: '', position: 2, distances: [] },
]

function sortStagesByStartTime(stages: StageInput[]): StageInput[] {
  return [...stages]
    .sort((a, b) => {
      if (!a.start_time && !b.start_time) return a.position - b.position
      if (!a.start_time) return 1
      if (!b.start_time) return -1
      return a.start_time.localeCompare(b.start_time)
    })
    .map((s, i) => ({ ...s, position: i }))
}

function formatTime(iso: string): string {
  // datetime-local strings are 'YYYY-MM-DDTHH:mm' — no timezone suffix.
  // Slicing avoids Date constructor interpreting them as local time.
  return iso.slice(11, 16)
}

function weekdayFromDateString(dateStr: string): string {
  // Append T00:00Z so the Date is parsed as UTC midnight, giving the correct weekday.
  return new Date(dateStr + 'T00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return ''
  const startDate = start.slice(0, 10)
  const startTime = start.slice(11, 16)
  const day = weekdayFromDateString(startDate)
  if (!end) return `${day} ${startTime}`
  const endDate = end.slice(0, 10)
  const endTime = end.slice(11, 16)
  if (startDate === endDate) return `${day} ${startTime}–${endTime}`
  const endDay = weekdayFromDateString(endDate)
  return `${day} ${startTime}–${endDay} ${endTime}`
}

export default function StageList({ stages, onChange, categoryType, onCategoryTypeChange }: Props) {
  const { t } = useTranslation('admin')
  const [modalTarget, setModalTarget] = useState<{ index: number | null }>({ index: null })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const isModalOpen = modalTarget.index !== null || modalTarget.index === -1

  const effectiveStages = sortStagesByStartTime(stages.length > 0 ? stages : DEFAULT_STAGES)
  const raceStageCount = effectiveStages.filter((s) => s.stage_type === 'race').length

  function toggleExpand(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function openAdd() {
    setModalTarget({ index: -1 })
  }

  function openEdit(index: number) {
    setModalTarget({ index })
  }

  function handleModalSave(updated: StageInput) {
    let newStages: StageInput[]
    if (modalTarget.index === -1) {
      newStages = [...effectiveStages, { ...updated, position: effectiveStages.length }]
    } else {
      newStages = effectiveStages.map((s, i) =>
        i === modalTarget.index ? { ...updated, position: i } : s
      )
    }
    onChange(sortStagesByStartTime(newStages))
    setModalTarget({ index: null })
  }

  function handleDelete(index: number) {
    const stage = effectiveStages[index]
    if (stage.stage_type === 'race' && raceStageCount <= 1) return
    const newStages = effectiveStages
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, position: i }))
    onChange(newStages)
  }

  function closeModal() {
    setModalTarget({ index: null })
  }

  const editingStage =
    modalTarget.index !== null && modalTarget.index >= 0
      ? effectiveStages[modalTarget.index]
      : null

  return (
    <>
      <div className="rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-white">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {t('eventConfig.stagesLabel')} <span className="text-red-400">*</span>
          </span>
          <button
            type="button"
            onClick={openAdd}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md px-3 py-1.5 bg-white hover:border-gray-300 transition-colors"
          >
            {t('eventConfig.addStage')}
          </button>
        </div>

        {/* Stage rows */}
        <div className="divide-y divide-gray-100">
          {effectiveStages.map((stage, i) => {
            const isLastRace = stage.stage_type === 'race' && raceStageCount <= 1
            const isExpanded = expanded.has(i)
            return (
              <div key={i} className="bg-white">
                {/* Collapsed row */}
                <div className="flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors">
                  {/* Expand toggle */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-sm font-medium"
                    aria-label={isExpanded ? t('eventConfig.collapseStage') : t('eventConfig.expandStage')}
                  >
                    {isExpanded ? '−' : '·'}
                  </button>

                  {/* Name */}
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate min-w-0">
                    {stage.name || '—'}
                  </span>

                  {/* Type badge */}
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      stage.stage_type === 'race'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                        : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200'
                    }`}
                  >
                    {stage.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')}
                  </span>

                  {/* Time range */}
                  <span className="shrink-0 text-xs text-gray-400 tabular-nums w-40 text-right">
                    {formatTimeRange(stage.start_time, stage.end_time)}
                  </span>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(i)}
                      className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      {t('actions.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(i)}
                      disabled={isLastRace}
                      title={isLastRace ? t('eventConfig.cannotDeleteLastRace') : t('actions.delete')}
                      className="rounded px-2 py-1 text-xs text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-300 disabled:hover:bg-transparent"
                    >
                      {t('actions.delete')}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className={`px-4 pb-3 ml-7 grid gap-6 w-1/2 ${stage.stage_type === 'race' ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">{t('eventConfig.stageVenueLabel')}</p>
                      <p className="text-xs text-gray-700">{stage.venue || '–'}</p>
                    </div>
                    {stage.stage_type === 'race' && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-gray-400 mb-0.5">
                            {categoryType === 'time' ? t('eventConfig.categoryTimes') : t('eventConfig.categoryDistances')}
                          </p>
                          <p className="text-xs text-gray-700">
                            {stage.distances.length > 0 ? stage.distances.map((d) => d.label).join(', ') : '–'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-400 mb-0.5">{t('eventConfig.stageFormalStartEnd')}</p>
                          <p className="text-xs text-gray-700">
                            {stage.start_time
                              ? `${formatTime(stage.start_time)}${stage.end_time ? ` / ${formatTime(stage.end_time)}` : ''}`
                              : '–'}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Inline Race stage validation */}
      {raceStageCount === 0 && (
        <p className="flex items-start gap-1.5 text-xs text-gray-500 mt-2">
          <span className="shrink-0 mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-gray-400 text-[10px] font-bold leading-none">i</span>
          {t('eventConfig.noRaceStageWarning')}
        </p>
      )}

      {/* Modal */}
      {isModalOpen && (
        <StageModal
          stage={editingStage}
          onSave={handleModalSave}
          onClose={closeModal}
          categoryType={categoryType}
          onCategoryTypeChange={onCategoryTypeChange}
        />
      )}
    </>
  )
}
