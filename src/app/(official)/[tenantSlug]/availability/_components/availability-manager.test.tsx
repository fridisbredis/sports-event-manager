import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AvailabilityManager } from './availability-manager'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'availability.title': 'Time off',
        'availability.description': 'Tell us when you cannot work.',
        'availability.addButton': 'Add time off',
        'availability.periodLabel': 'Period',
        'availability.allDayLabel': 'All day',
        'availability.reasonLabel': 'Reason',
        'availability.save': 'Save',
        'availability.cancel': 'Cancel',
        'availability.emptyTitle': 'No time off yet',
        'availability.emptyDescription': 'Add a period when you are unavailable.',
        'availability.sectionLabel': 'Your time off',
      })[key] ?? key,
  }),
}))

vi.mock('../actions', () => ({
  declareUnavailability: vi.fn(),
  withdrawUnavailability: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

describe('AvailabilityManager add form', () => {
  beforeEach(() => {
    // jsdom has no layout, so scrollIntoView is absent entirely.
    Element.prototype.scrollIntoView = vi.fn()
  })

  function openForm() {
    render(<AvailabilityManager tenantSlug="testklubben" periods={[]} eventDates={null} />)
    fireEvent.click(screen.getByText('Add time off'))
  }

  it('moves focus into the form when it opens', () => {
    // Sharper than the panel disclosure one level up: the Add button is
    // REPLACED by the form rather than staying above it, so the element
    // holding focus is unmounted and focus falls to <body>. The user loses
    // their place with nothing announced, and the next Tab restarts from the
    // top of the document.
    openForm()

    const form = screen.getByRole('region', { name: 'Add time off' })
    expect(document.activeElement).toBe(form)
  })

  it('scrolls the form into view', () => {
    openForm()

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('keeps the form container out of the tab order', () => {
    // Focusable programmatically, never its own Tab stop: tabbing through the
    // form should be the fields and the two buttons.
    openForm()

    expect(screen.getByRole('region', { name: 'Add time off' }).getAttribute('tabindex')).toBe('-1')
  })

  it('focuses the region, not the date picker inside it', () => {
    // Landing on the picker would pop its calendar open unbidden, and would
    // skip past the heading that says what this region is.
    openForm()

    expect(document.activeElement?.getAttribute('role')).toBe('region')
  })
})
