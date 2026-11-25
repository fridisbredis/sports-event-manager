import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import svAdmin from '@/../public/locales/sv/admin.json'
import { WsSlotModal } from './ws-slot-modal'
import type { LocalAssignment, OfficialData } from './scheduling-types'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === 'object'
              ? (current as Record<string, unknown>)[part]
              : undefined,
          svAdmin
        )
      return typeof value === 'string' ? value : key
    },
  }),
}))

const OFFICIALS: OfficialData[] = [
  { id: 'o-mikael', name: 'Mikael Saras', invite_status: 'confirmed', avatar_url: null },
]

function assignment(officialId: string): LocalAssignment {
  return {
    id: `a-${officialId}`,
    official_id: officialId,
    workstation_id: 'ws-1',
    timeslot_start: '2026-08-06T12:00:00.000Z',
    timeslot_end: '2026-08-06T13:00:00.000Z',
    status: 'assigned',
    slot_index: 1,
  }
}

function renderModal(assignedInSlot: LocalAssignment[]) {
  render(
    <WsSlotModal
      title="Position 1 — start line, 12:00"
      listLabel="Available at 12:00"
      candidates={[]}
      search=""
      onSearchChange={() => {}}
      assignedInSlot={assignedInSlot}
      officials={OFFICIALS}
      onRemove={() => {}}
      onAdd={() => {}}
      onClose={() => {}}
    />
  )
}

// B28: an assignment whose official is missing from the roster (removed before
// removal also deleted assignments) used to show as a bare '—'.
describe('WsSlotModal — assigned official', () => {
  it('shows the name of an official in the roster', () => {
    renderModal([assignment('o-mikael')])

    expect(screen.getByText('Mikael Saras')).toBeInTheDocument()
  })

  it('names an official who is no longer in the roster instead of showing a dash', () => {
    renderModal([assignment('o-removed')])

    expect(screen.getByText('Borttagen funktionär')).toBeInTheDocument()
    expect(screen.queryByText('—')).toBeNull()
    // Still removable: that is how the admin clears the position.
    expect(screen.getByRole('button', { name: 'Ta bort' })).toBeInTheDocument()
  })
})
