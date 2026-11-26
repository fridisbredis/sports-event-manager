import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UnsavedChangesDialog from './unsaved-changes-dialog'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderDialog(overrides: Partial<Parameters<typeof UnsavedChangesDialog>[0]> = {}) {
  const props = {
    open: true,
    onLeave: vi.fn(),
    onStay: vi.fn(),
    onSave: vi.fn(),
    isSaving: false,
    ...overrides,
  }
  render(<UnsavedChangesDialog {...props} />)
  return props
}

describe('UnsavedChangesDialog', () => {
  it('offers Save and Leave anyway when the form can save', () => {
    const props = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }))
    expect(props.onSave).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'actions.leaveAnyway' }))
    expect(props.onLeave).toHaveBeenCalledTimes(1)

    expect(screen.queryByRole('button', { name: 'actions.stayOnPage' })).toBeNull()
  })

  it('stays on the page, not leaves, when dismissed with Escape', () => {
    const props = renderDialog()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(props.onStay).toHaveBeenCalledTimes(1)
    expect(props.onLeave).not.toHaveBeenCalled()
  })

  it('locks Leave anyway while the save runs', () => {
    const props = renderDialog({ isSaving: true })

    fireEvent.click(screen.getByRole('button', { name: 'actions.leaveAnyway' }))

    expect(props.onLeave).not.toHaveBeenCalled()
  })

  it('falls back to Stay and Leave anyway without a save handler', () => {
    const props = renderDialog({ onSave: undefined })

    fireEvent.click(screen.getByRole('button', { name: 'actions.stayOnPage' }))
    expect(props.onStay).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'actions.save' })).toBeNull()
  })
})
