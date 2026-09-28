'use client'

import { useState } from 'react'
import type { StageInput } from '../actions'
import StageModal from './stage-modal'
import ConfirmDialog from '@/components/confirm-dialog'
import { useTranslation } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight } from '@gravity-ui/icons'

interface Props {
  stages: StageInput[]
  onChange: (stages: StageInput[]) => void
}

const DEFAULT_STAGES: StageInput[] = [
  {
    name: 'Setup',
    stage_type: 'non_race',
    race_type: 'distance',
    start_time: null,
    end_time: null,
    venue: '',
    position: 0,
    distances: [],
  },
  {
    name: 'Race',
    stage_type: 'race',
    race_type: 'distance',
    start_time: null,
    end_time: null,
    venue: '',
    position: 1,
    distances: [],
  },
  {
    name: 'Teardown',
    stage_type: 'non_race',
    race_type: 'distance',
    start_time: null,
    end_time: null,
    venue: '',
    position: 2,
    distances: [],
  },
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
  return new Date(dateStr + 'T00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  })
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

export default function StageList({ stages, onChange }: Props) {
  const { t } = useTranslation('admin')
  const [modalTarget, setModalTarget] = useState<{ index: number | null }>({ index: null })
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
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
    setDeleteTarget(index)
  }

  function confirmDelete() {
    if (deleteTarget === null) return
    const newStages = effectiveStages
      .filter((_, i) => i !== deleteTarget)
      .map((s, i) => ({ ...s, position: i }))
    setDeleteTarget(null)
    onChange(newStages)
  }

  function closeModal() {
    setModalTarget({ index: null })
  }

  const editingStage =
    modalTarget.index !== null && modalTarget.index >= 0 ? effectiveStages[modalTarget.index] : null

  return (
    <>
      <div className="overflow-hidden rounded-large">
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="section-label">
            {t('eventConfig.stagesLabel')}
            <span className="text-danger-text">*</span>
          </span>
          <Button
            type="button"
            variant="bordered"
            size="sm"
            onPress={openAdd}
            className="rounded-control border-tenant-primary bg-white px-4 font-semibold text-tenant-primary"
          >
            {t('eventConfig.addStage')}
          </Button>
        </div>

        {/* Stage rows */}
        <div className="divide-y divide-gray-100">
          {effectiveStages.map((stage, i) => {
            const isLastRace = stage.stage_type === 'race' && raceStageCount <= 1
            const isExpanded = expanded.has(i)
            return (
              <div key={i} className="bg-white">
                {/* Collapsed row */}
                <div className="flex flex-nowrap items-center gap-2 px-4 py-3 transition-colors">
                  {/* Expand toggle */}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    onPress={() => toggleExpand(i)}
                    aria-label={
                      isExpanded ? t('eventConfig.collapseStage') : t('eventConfig.expandStage')
                    }
                  >
                    {isExpanded ? <ChevronDown /> : <ChevronRight />}
                  </Button>

                  {/* Name */}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                    {stage.name || '—'}
                  </span>

                  {/* Type badge */}
                  <span
                    className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium ${
                      stage.stage_type === 'race'
                        ? 'bg-tenant-accent-tint text-tenant-accent-tint-text'
                        : 'bg-status-neutral-bg text-status-neutral-text'
                    }`}
                  >
                    {stage.stage_type === 'race'
                      ? t('eventConfig.stageTypeRace')
                      : t('eventConfig.stageTypeNonRace')}
                  </span>

                  {/* Time range */}
                  <span className="shrink-0 whitespace-nowrap text-right text-[13px] text-ink-muted tabular-nums">
                    {formatTimeRange(stage.start_time, stage.end_time)}
                  </span>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => openEdit(i)}
                      className="font-medium text-tenant-primary-tint-text"
                    >
                      {t('actions.edit')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => handleDelete(i)}
                      className="font-medium text-danger-text"
                      isDisabled={isLastRace}
                      title={
                        isLastRace ? t('eventConfig.cannotDeleteLastRace') : t('actions.delete')
                      }
                    >
                      {t('actions.delete')}
                    </Button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div
                    className={`ml-7 grid gap-x-6 gap-y-3 px-4 pb-3 ${stage.stage_type === 'race' ? 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]' : 'grid-cols-1'}`}
                  >
                    <div>
                      <p className="text-xs font-medium text-gray-400 mb-0.5">
                        {t('eventConfig.stageVenueLabel')}
                      </p>
                      <p className="text-xs text-gray-700">{stage.venue || '–'}</p>
                    </div>
                    {stage.stage_type === 'race' && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-gray-400 mb-0.5">
                            {stage.race_type === 'time'
                              ? t('eventConfig.categoryTimes')
                              : t('eventConfig.categoryDistances')}
                          </p>
                          <p className="text-xs text-gray-700">
                            {stage.distances.length > 0
                              ? stage.distances.map((d) => d.label).join(', ')
                              : '–'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-400 mb-0.5">
                            {t('eventConfig.stageFormalStartEnd')}
                          </p>
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
          <span className="shrink-0 mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-gray-400 text-[10px] font-bold leading-none">
            i
          </span>
          {t('eventConfig.noRaceStageWarning')}
        </p>
      )}

      {/* Modal */}
      {isModalOpen && (
        <StageModal stage={editingStage} onSave={handleModalSave} onClose={closeModal} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('actions.delete')}
        body={t('eventConfig.deleteStageConfirm')}
        cancelLabel={t('actions.cancel', { ns: 'common' })}
        confirmLabel={t('actions.delete', { ns: 'common' })}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        destructive
      />
    </>
  )
}
