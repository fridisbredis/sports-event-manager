'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { StageInput } from '../actions'
import { useTranslation } from '@/lib/i18n/client'
import DateTimePicker from '@/components/date-time-picker'

interface Props {
  stage: StageInput | null
  onSave: (stage: StageInput) => void
  onClose: () => void
  categoryType: 'distance' | 'time'
  onCategoryTypeChange: (type: 'distance' | 'time') => void
}

const emptyStage = (): StageInput => ({
  name: '',
  stage_type: 'race',
  start_time: null,
  end_time: null,
  venue: '',
  position: 0,
  distances: [],
})

export default function StageModal({ stage, onSave, onClose, categoryType, onCategoryTypeChange }: Props) {
  const { t } = useTranslation('admin')
  const isAdd = stage === null

  const [form, setForm] = useState<StageInput>(isAdd ? emptyStage() : { ...stage })
  const [distancesText, setDistancesText] = useState(
    isAdd ? '' : stage.distances.map((d) => d.label).join(', ')
  )
  const [errors, setErrors] = useState<{ name?: string; end_time?: string }>({})

  useEffect(() => {
    setForm(isAdd ? emptyStage() : { ...stage! })
    setDistancesText(isAdd ? '' : stage!.distances.map((d) => d.label).join(', '))
    setErrors({})
  }, [stage, isAdd])

  function validate(): boolean {
    const errs: { name?: string; end_time?: string } = {}
    if (!form.name.trim()) errs.name = t('eventConfig.stageNameRequired')
    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      errs.end_time = t('eventConfig.stageEndTimeError')
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSave() {
    if (!validate()) return
    const distances = distancesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, i) => ({ label, position: i }))
    const cleaned: StageInput = {
      ...form,
      name: form.name.trim(),
      venue: form.venue.trim(),
      distances: form.stage_type === 'race' ? distances : [],
    }
    onSave(cleaned)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            {isAdd ? t('eventConfig.addStageTitle') : t('eventConfig.editStageTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
            aria-label={t('actions.close')}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {t('eventConfig.stageName')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder={t('eventConfig.stageNamePlaceholder')}
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                errors.name ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
              }`}
            />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('eventConfig.stageTypeLabel')}</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit text-sm">
              {(['race', 'non_race'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, stage_type: type }))}
                  className={`px-4 py-2 font-medium transition-colors ${
                    form.stage_type === type
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:text-gray-900 bg-white'
                  }`}
                >
                  {type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')}
                </button>
              ))}
            </div>
          </div>

          {/* Start / end time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('eventConfig.stageStartTime')}</label>
              <DateTimePicker
                value={form.start_time ?? ''}
                onChange={(v) => setForm((p) => ({ ...p, start_time: v || null }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('eventConfig.stageEndTime')}</label>
              <DateTimePicker
                value={form.end_time ?? ''}
                onChange={(v) => setForm((p) => ({ ...p, end_time: v || null }))}
                hasError={!!errors.end_time}
              />
              {errors.end_time && <p className="mt-1 text-xs text-red-500">{errors.end_time}</p>}
            </div>
          </div>

          {/* Venue */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('eventConfig.stageVenueLabel')}</label>
            <input
              type="text"
              value={form.venue}
              onChange={(e) => setForm((p) => ({ ...p, venue: e.target.value }))}
              placeholder={t('eventConfig.stageVenuePlaceholder')}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>

          {/* Distance / Time — Race only */}
          {form.stage_type === 'race' ? (
            <div className="space-y-3">
              {/* Category type toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('eventConfig.categoryType')}</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit text-sm">
                  {(['distance', 'time'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onCategoryTypeChange(type)}
                      className={`px-4 py-2 font-medium transition-colors ${
                        categoryType === type
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-500 hover:text-gray-900 bg-white'
                      }`}
                    >
                      {type === 'distance' ? t('eventConfig.categoryDistance') : t('eventConfig.categoryTime')}
                    </button>
                  ))}
                </div>
              </div>
              {/* Distances / Times input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {categoryType === 'distance' ? t('eventConfig.categoryDistances') : t('eventConfig.categoryTimes')}
                </label>
                <input
                  type="text"
                  value={distancesText}
                  onChange={(e) => setDistancesText(e.target.value)}
                  placeholder={categoryType === 'distance' ? t('eventConfig.distancesPlaceholder') : t('eventConfig.timesPlaceholder')}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              {t('eventConfig.nonRaceHint')}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            {t('eventConfig.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            {t('eventConfig.saveStage')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
