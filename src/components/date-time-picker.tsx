'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  value: string       // 'YYYY-MM-DDTHH:mm' or ''
  onChange: (value: string) => void
  min?: string        // 'YYYY-MM-DDTHH:mm'
  max?: string        // 'YYYY-MM-DDTHH:mm'
  placeholder?: string
  hasError?: boolean
  disabled?: boolean
}

// Parse a 'YYYY-MM-DDTHH:mm' string using local time so react-day-picker's
// internal date comparisons (which also use local time) stay consistent.
// datetime-local values carry no timezone, so local time is correct here.
function parse(raw: string): { day: Date; time: string } | null {
  if (!raw || !raw.includes('T')) return null
  const [datePart, timePart] = raw.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  if (!y || !m || !d) return null
  return { day: new Date(y, m - 1, d), time: (timePart ?? '00:00').slice(0, 5) }
}

function toValue(day: Date, time: string): string {
  const y = day.getFullYear()
  const m = String(day.getMonth() + 1).padStart(2, '0')
  const d = String(day.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}T${time}`
}

function formatDisplay(raw: string): string {
  const p = parse(raw)
  if (!p) return ''
  const weekday = p.day.toLocaleDateString('en-GB', { weekday: 'short' })
  const day     = p.day.getDate()
  const month   = p.day.toLocaleDateString('en-GB', { month: 'short' })
  return `${weekday} ${day} ${month} · ${p.time}`
}

export default function DateTimePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  hasError,
  disabled,
}: Props) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 })

  const parsed    = parse(value)
  const selectedDay = parsed?.day
  const time        = parsed?.time ?? '12:00'

  const minParsed = min ? parse(min.slice(0, 16)) : undefined
  const maxParsed = max ? parse(max.slice(0, 16)) : undefined
  const minDay = minParsed?.day
  const maxDay = maxParsed?.day

  // Constrain the time input when the selected day is a boundary day
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  const timeMin = selectedDay && minDay && isSameDay(selectedDay, minDay) ? minParsed?.time : undefined
  const timeMax = selectedDay && maxDay && isSameDay(selectedDay, maxDay) ? maxParsed?.time : undefined

  const reposition = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({
      top:      r.bottom + window.scrollY + 6,
      left:     r.left   + window.scrollX,
      minWidth: r.width,
    })
  }, [])

  function openPicker() {
    reposition()
    setOpen(true)
  }

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function clampTime(t: string, tMin?: string, tMax?: string): string {
    if (tMin && t < tMin) return tMin
    if (tMax && t > tMax) return tMax
    return t
  }

  function handleDaySelect(day: Date | undefined) {
    if (!day) return
    const tMin = minDay && isSameDay(day, minDay) ? minParsed?.time : undefined
    const tMax = maxDay && isSameDay(day, maxDay) ? maxParsed?.time : undefined
    onChange(toValue(day, clampTime(time, tMin, tMax)))
  }

  function handleTimeChange(t: string) {
    if (selectedDay) onChange(toValue(selectedDay, clampTime(t, timeMin, timeMax)))
  }

  function handleClear() {
    onChange('')
    setOpen(false)
  }

  const triggerBase =
    'w-full rounded-lg border px-3.5 py-2.5 text-sm text-left transition-colors outline-none focus:ring-2 focus:ring-gray-900/10'
  const triggerColor = disabled
    ? 'border-gray-100 bg-gray-50 cursor-not-allowed'
    : hasError
      ? 'border-red-300 focus:ring-red-400/20'
      : 'border-gray-200 hover:border-gray-300'

  const disabledDays = [
    ...(minDay ? [{ before: minDay }] : []),
    ...(maxDay ? [{ after: maxDay }] : []),
  ]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={disabled ? undefined : openPicker}
        disabled={disabled}
        className={`${triggerBase} ${triggerColor}`}
      >
        {value ? (
          <span className="text-gray-900">{formatDisplay(value)}</span>
        ) : (
          <span className="text-gray-400">{placeholder ?? t('datePicker.placeholder')}</span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: pos.top,
            left: pos.left,
            minWidth: pos.minWidth,
            // Override react-day-picker accent to match gray-900
            '--rdp-accent-color': '#111827',
            '--rdp-accent-background-color': '#111827',
            '--rdp-day_button-border-radius': '6px',
          } as React.CSSProperties}
          className="z-[200] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden"
        >
          <DayPicker
            mode="single"
            selected={selectedDay}
            onSelect={handleDaySelect}
            defaultMonth={selectedDay ?? minDay}
            disabled={disabledDays.length ? disabledDays : undefined}
            startMonth={minDay}
            endMonth={maxDay}
            weekStartsOn={1}
          />

          {/* Time row */}
          <div className="px-4 pb-3 pt-2 border-t border-gray-100 flex items-center gap-3">
            <label className="text-xs font-medium text-gray-500 shrink-0">{t('datePicker.timeLabel')}</label>
            <input
              type="time"
              value={time}
              min={timeMin}
              max={timeMax}
              onChange={(e) => handleTimeChange(e.target.value)}
              disabled={!selectedDay}
              className="flex-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-40"
            />
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                {t('datePicker.clear')}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
