'use client'

import { Button } from '@heroui/react';
import { useEffect, useState } from 'react'


type Todo = { id: string; instruction_text: string; position: number }
type WorkstationRef = {
  id: string
  name: string
  description: string | null
  workstation_todos: Todo[]
} | null
export type AssignmentRow = {
  id: string
  timeslot_start: string
  timeslot_end: string
  status: string
  workstations: WorkstationRef
}

type View = 'time' | 'work-area'

interface Strings {
  title: string
  readOnly: string
  byTime: string
  byWorkstation: string
  noAssignments: string
  noAssignmentsDescription: string
}

interface Props {
  assignments: AssignmentRow[]
  strings: Strings
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function EmptyState({ strings }: { strings: Strings }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="w-20 h-20 rounded-xl border-2 border-gray-200 bg-gray-100 flex items-center justify-center mb-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-10 h-10 text-gray-300"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
        </svg>
      </div>
      <p className="text-base font-semibold text-gray-900 mb-1">
        {strings.noAssignments}
      </p>
      <p className="text-sm text-gray-500 leading-relaxed">
        {strings.noAssignmentsDescription}
      </p>
    </div>
  )
}

function TimeView({ assignments }: { assignments: AssignmentRow[] }) {
  return (
    <div className="flex flex-col gap-0">
      {assignments.map((a) => {
        const ws = a.workstations
        return (
          <div key={a.id} className="flex items-center gap-3 py-3">
            <span className="w-12 shrink-0 text-sm font-medium text-gray-500 pt-3">
              {formatTime(a.timeslot_start)}
            </span>
            <div className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">{ws?.name ?? '—'}</p>
              {ws?.description ? (
                <p className="text-xs text-gray-500 mt-0.5">{ws.description}</p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CheckboxIcon() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-4 h-4 shrink-0 text-gray-400"
    >
      <rect x="1" y="1" width="16" height="16" rx="3" />
    </svg>
  )
}

function WorkAreaView({ assignments }: { assignments: AssignmentRow[] }) {
  // Group by workstation id, preserving first-seen order
  const seen = new Set<string>()
  const groups: { ws: NonNullable<WorkstationRef>; rows: AssignmentRow[] }[] = []

  for (const a of assignments) {
    if (!a.workstations) continue
    const ws = a.workstations
    if (!seen.has(ws.id)) {
      seen.add(ws.id)
      groups.push({ ws, rows: [a] })
    } else {
      groups.find((g) => g.ws.id === ws.id)!.rows.push(a)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ ws }) => {
        const sortedTodos = [...ws.workstation_todos].sort((a, b) => a.position - b.position)
        return (
          <div key={ws.id}>
            <p className="text-sm font-semibold text-gray-900 mb-2">
              {ws.name}
              {ws.description ? (
                <span className="font-normal text-gray-500"> · {ws.description}</span>
              ) : null}
            </p>
            {sortedTodos.length > 0 ? (
              <div className="flex flex-col gap-2">
                {sortedTodos.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-2.5">
                    <CheckboxIcon />
                    <span className="text-sm text-gray-700">{todo.instruction_text}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function ScheduleView({ assignments, strings }: Props) {
  const [view, setView] = useState<View>('time')

  useEffect(() => {
    const saved = localStorage.getItem('official-schedule-view')
    if (saved === 'time' || saved === 'work-area') setView(saved)
  }, [])

  function handleViewChange(v: View) {
    setView(v)
    localStorage.setItem('official-schedule-view', v)
  }

  return (
    <div className="px-5 pt-10 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{strings.title}</h1>
        <span className="text-xs font-medium text-gray-400 border border-gray-200 rounded-full px-2.5 py-1">
          {strings.readOnly}
        </span>
      </div>

      {/* View toggle */}
      <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-6">
        <Button
          onClick={() => handleViewChange('time')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            view === 'time'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {strings.byTime}
        </Button>
        <Button 
          onClick={() => handleViewChange('work-area')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            view === 'work-area'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {strings.byWorkstation}
        </Button>
      </div>

      {/* Content */}
      {assignments.length === 0 ? (
        <EmptyState strings={strings} />
      ) : view === 'time' ? (
        <TimeView assignments={assignments} />
      ) : (
        <WorkAreaView assignments={assignments} />
      )}
    </div>
  )
}
