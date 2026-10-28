'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input, DateRangePicker } from '@/components/ui/form-fields'
import { CalendarDateTime, type DateValue } from '@internationalized/date'
import type { RangeValue } from '@react-types/shared'
import type { StageInput } from '../actions'
import { useTranslation } from '@/lib/i18n/client'
import { normalizeResultsUrl } from '../_utils'

// start_time/end_time are stored as 'YYYY-MM-DDTHH:mm' wall-clock strings with
// no timezone attached, so they're parsed into CalendarDateTime (not
// ZonedDateTime) — that keeps the value tz-naive and avoids any
// browser-timezone conversion when round-tripping through the picker.
function parseLocal(raw: string | null): CalendarDateTime | null {
  if (!raw || !raw.includes('T')) return null
  const [datePart, timePart] = raw.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  const [h, min] = (timePart ?? '00:00').split(':').map(Number)
  return new CalendarDateTime(y, m, d, h || 0, min || 0)
}

function toLocalString(value: DateValue): string {
  const y = String(value.year).padStart(4, '0')
  const m = String(value.month).padStart(2, '0')
  const d = String(value.day).padStart(2, '0')
  const cdt = value as CalendarDateTime
  const h = String(cdt.hour ?? 0).padStart(2, '0')
  const min = String(cdt.minute ?? 0).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

interface StageErrors {
  name?: string
  end_time?: string
  results_url?: string
}

interface Props {
  stage: StageInput | null
  onSave: (stage: StageInput) => void
  onClose: () => void
}

const emptyStage = (): StageInput => ({
  name: '',
  stage_type: 'race',
  race_type: 'distance',
  start_time: null,
  end_time: null,
  venue: '',
  results_url: null,
  position: 0,
  distances: [],
})

export default function StageModal({ stage, onSave, onClose }: Props) {
  const { t } = useTranslation('admin')
  const isAdd = stage === null

  const [form, setForm] = useState<StageInput>(isAdd ? emptyStage() : { ...stage })
  const [distancesText, setDistancesText] = useState(
    isAdd ? '' : stage.distances.map((d) => d.label).join(', ')
  )
  const [errors, setErrors] = useState<StageErrors>({})

  // The link is held as raw text while editing so a half-typed URL isn't
  // normalised out from under the cursor; it is parsed once on save.
  const [resultsUrlText, setResultsUrlText] = useState(stage?.results_url ?? '')

  function validate(): { ok: false } | { ok: true; resultsUrl: string | null } {
    const errs: StageErrors = {}
    if (!form.name.trim()) errs.name = t('eventConfig.stageNameRequired')
    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      errs.end_time = t('eventConfig.stageEndTimeError')
    }

    // Only validated for a Race stage — the field isn't shown for non_race, so
    // a leftover value there (type switched after typing a link) must not
    // block the save. It is dropped instead, matching what the RPC stores.
    const checked = form.stage_type === 'race' ? normalizeResultsUrl(resultsUrlText) : null
    if (checked && !checked.ok) errs.results_url = t('eventConfig.stageResultsUrlError')

    setErrors(errs)
    if (Object.keys(errs).length > 0) return { ok: false }
    return { ok: true, resultsUrl: checked?.ok ? checked.value : null }
  }

  function handleSave() {
    const result = validate()
    if (!result.ok) return
    const distances = distancesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, i) => ({ label, position: i }))
    const cleaned: StageInput = {
      ...form,
      name: form.name.trim(),
      venue: form.venue.trim(),
      results_url: result.resultsUrl,
      distances: form.stage_type === 'race' ? distances : [],
    }
    onSave(cleaned)
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="md"
      scrollBehavior="inside"
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="text-sm font-semibold">
              {isAdd ? t('eventConfig.addStageTitle') : t('eventConfig.editStageTitle')}
            </ModalHeader>

            <ModalBody className="space-y-4">
              {/* Name */}
              <Input
                label={t('eventConfig.stageName')}
                isRequired
                value={form.name}
                onValueChange={(v) => setForm((p) => ({ ...p, name: v }))}
                placeholder={t('eventConfig.stageNamePlaceholder')}
                isInvalid={!!errors.name}
                errorMessage={errors.name}
              />

              {/* Stage type toggle */}
              <div>
                <label className="block text-sm font-medium text-default-700 mb-1.5">
                  {t('eventConfig.stageTypeLabel')}
                </label>
                <div className="flex rounded-lg border border-default-200 overflow-hidden w-fit text-sm">
                  {(['race', 'non_race'] as const).map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      radius="none"
                      onPress={() => setForm((p) => ({ ...p, stage_type: type }))}
                      color={form.stage_type === type ? 'primary' : 'default'}
                      variant={form.stage_type === type ? 'solid' : 'light'}
                    >
                      {type === 'race'
                        ? t('eventConfig.stageTypeRace')
                        : t('eventConfig.stageTypeNonRace')}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Start / end time */}
              <DateRangePicker
                label={t('eventConfig.stageTimeRange')}
                granularity="minute"
                hourCycle={24}
                value={
                  form.start_time && form.end_time
                    ? { start: parseLocal(form.start_time)!, end: parseLocal(form.end_time)! }
                    : null
                }
                onChange={(range: RangeValue<DateValue> | null) => {
                  setForm((p) => ({
                    ...p,
                    start_time: range ? toLocalString(range.start) : null,
                    end_time: range ? toLocalString(range.end) : null,
                  }))
                }}
                isInvalid={!!errors.end_time}
                errorMessage={errors.end_time}
              />

              {/* Venue */}
              <Input
                label={t('eventConfig.stageVenueLabel')}
                value={form.venue}
                onValueChange={(v) => setForm((p) => ({ ...p, venue: v }))}
                placeholder={t('eventConfig.stageVenuePlaceholder')}
              />

              {/* Distance / Time — Race only */}
              {form.stage_type === 'race' ? (
                <div className="space-y-3">
                  {/* Race type toggle */}
                  <div>
                    <label className="block text-sm font-medium text-default-700 mb-1.5">
                      {t('eventConfig.categoryType')}
                    </label>
                    <div className="flex rounded-lg border border-default-200 overflow-hidden w-fit text-sm">
                      {(['distance', 'time'] as const).map((type) => (
                        <Button
                          key={type}
                          type="button"
                          size="sm"
                          radius="none"
                          onPress={() => setForm((p) => ({ ...p, race_type: type }))}
                          color={form.race_type === type ? 'primary' : 'default'}
                          variant={form.race_type === type ? 'solid' : 'light'}
                        >
                          {type === 'distance'
                            ? t('eventConfig.categoryDistance')
                            : t('eventConfig.categoryTime')}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Distances / Times input */}
                  <Input
                    label={
                      form.race_type === 'distance'
                        ? t('eventConfig.categoryDistances')
                        : t('eventConfig.categoryTimes')
                    }
                    value={distancesText}
                    onValueChange={setDistancesText}
                    placeholder={
                      form.race_type === 'distance'
                        ? t('eventConfig.distancesPlaceholder')
                        : t('eventConfig.timesPlaceholder')
                    }
                  />

                  {/* Results link — Race stages only, since a Setup or
                      Teardown stage has no results to publish. One plain
                      link per stage: the typed multi-link model
                      (PROPOSED-external-links) stays a draft, and this field
                      is deliberately the simple version of it. */}
                  <Input
                    type="url"
                    inputMode="url"
                    label={t('eventConfig.stageResultsUrlLabel')}
                    value={resultsUrlText}
                    onValueChange={(v) => {
                      setResultsUrlText(v)
                      // Clear the error as soon as they start fixing it,
                      // rather than leaving it red until the next save.
                      setErrors((p) => (p.results_url ? { ...p, results_url: undefined } : p))
                    }}
                    placeholder={t('eventConfig.stageResultsUrlPlaceholder')}
                    description={t('eventConfig.stageResultsUrlHint')}
                    isInvalid={!!errors.results_url}
                    errorMessage={errors.results_url}
                  />
                </div>
              ) : (
                <p className="text-xs text-default-400">{t('eventConfig.nonRaceHint')}</p>
              )}
            </ModalBody>

            <ModalFooter>
              <Button variant="light" onPress={onModalClose}>
                {t('eventConfig.cancel')}
              </Button>
              <Button color="primary" onPress={handleSave}>
                {t('eventConfig.saveStage')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
