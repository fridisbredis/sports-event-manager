'use client'

import { useState } from 'react'
import type { StageInput } from '../actions'
import StageModal from './stage-modal'
import ConfirmDialog from '@/components/confirm-dialog'
import { useTranslation } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight } from '@gravity-ui/icons'
import { DATE_LOCALE } from '@/lib/i18n/date-locale'

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
  // The weekday alone cannot be ordered by eye — two stages weeks apart can both
  // read 'Thu', making a correctly sorted list look shuffled. Day and month
  // disambiguate them; the year is omitted because it is already shown once in
  // the event's date range, and repeating it per row crowds the name out.
  return new Date(dateStr + 'T00:00Z').toLocaleDateString(DATE_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/**
 * Splits the range into its two endpoints so each can be kept unbreakable.
 * Returned as parts rather than one string because a plain string wraps
 * wherever it runs out of room — typically mid-date ('Thu 3 / Sept 10:00'),
 * which reads as a different date. Returns null when there is nothing to show.
 */
function stageTimeRangeParts(
  start: string | null,
  end: string | null
): { from: string; to: string | null } | null {
  if (!start) return null
  const startDate = start.slice(0, 10)
  const startTime = start.slice(11, 16)
  const from = `${weekdayFromDateString(startDate)} ${startTime}`
  if (!end) return { from, to: null }
  const endDate = end.slice(0, 10)
  const endTime = end.slice(11, 16)
  if (startDate === endDate) return { from, to: endTime }
  return { from, to: `${weekdayFromDateString(endDate)} ${endTime}` }
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
        <div className="flex items-center justify-between border-b border-edge px-4 py-3.5">
          <span className="section-label">
            {t('eventConfig.stagesLabel')}
            <span className="text-destructive">*</span>
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
        <div className="divide-y divide-edge-soft">
          {effectiveStages.map((stage, i) => {
            const isLastRace = stage.stage_type === 'race' && raceStageCount <= 1
            const isExpanded = expanded.has(i)
            const timeRange = stageTimeRangeParts(stage.start_time, stage.end_time)
            return (
              <div key={i} className="bg-white">
                {/* Collapsed row */}
                <div className="px-4 py-3 transition-colors">
                  <div className="flex items-start gap-2">
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

                    {/* Name and type badge. Only this line shares its width with
                        the actions, so the badge can sit beside the name. */}
                    <div className="min-w-0 flex-1 py-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className="min-w-0 truncate text-[15px] font-medium text-ink"
                          title={stage.name || undefined}
                        >
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
                      </div>
                    </div>

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
                        className="font-medium text-destructive"
                        isDisabled={isLastRace}
                        title={
                          isLastRace ? t('eventConfig.cannotDeleteLastRace') : t('actions.delete')
                        }
                      >
                        {t('actions.delete')}
                      </Button>
                    </div>
                  </div>

                  {/* Time range. Sits outside the row above so it spans the full
                      card width instead of the narrow column left over beside
                      the Edit/Delete buttons, which broke it after two or three
                      words. Each endpoint is kept unbreakable so a wrap at a
                      narrow width falls between them, never inside a date. */}
                  {timeRange && (
                    <p className="ml-9 mt-0.5 text-[13px] text-ink-muted tabular-nums">
                      <span className="whitespace-nowrap">{timeRange.from}</span>
                      {timeRange.to && (
                        <>
                          {'–'}
                          <span className="whitespace-nowrap">{timeRange.to}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div
                    className={`ml-7 mb-3 grid gap-x-6 gap-y-3 rounded-card-sm bg-tenant-primary-tint px-4 py-3 mr-4 ${stage.stage_type === 'race' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'}`}
                  >
                    <div>
                      <p className="mb-1 whitespace-nowrap text-[12px] font-semibold text-ink-muted">
                        {t('eventConfig.stageVenueLabel')}
                      </p>
                      <p className="text-[14px] text-ink-soft">{stage.venue || '–'}</p>
                    </div>
                    {stage.stage_type === 'race' && (
                      <>
                        <div>
                          <p className="mb-1 whitespace-nowrap text-[12px] font-semibold text-ink-muted">
                            {stage.race_type === 'time'
                              ? t('eventConfig.categoryTimes')
                              : t('eventConfig.categoryDistances')}
                          </p>
                          <p className="text-[14px] text-ink-soft">
                            {stage.distances.length > 0
                              ? stage.distances.map((d) => d.label).join(', ')
                              : '–'}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 whitespace-nowrap text-[12px] font-semibold text-ink-muted">
                            {t('eventConfig.stageFormalStartEnd')}
                          </p>
                          <p className="text-[14px] text-ink-soft">
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
