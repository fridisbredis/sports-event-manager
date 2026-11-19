import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TournamentsCard } from './tournaments-card'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { openTournaments } = vi.hoisted(() => ({ openTournaments: vi.fn() }))
vi.mock('@/lib/tournament/open-tournaments', () => ({ openTournaments }))

function renderCard() {
  render(<TournamentsCard appUrl="https://tournaments.test" tenantSlug="viadal" eventId="e1" />)
  return screen.getByRole('button', { name: /home\.tournaments/ })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TournamentsCard', () => {
  // HOME-01 opens the app directly; there is no tournaments page in between.
  it('opens the tournament app for this event on click', async () => {
    openTournaments.mockResolvedValue('opened')

    fireEvent.click(renderCard())

    await waitFor(() =>
      expect(openTournaments).toHaveBeenCalledWith('https://tournaments.test', 'viadal', 'e1')
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['popup-blocked', 'tournaments.popupBlocked'],
    ['forbidden', 'tournaments.forbidden'],
    ['unavailable', 'tournaments.unavailable'],
  ])('says why when the result is %s', async (result, message) => {
    openTournaments.mockResolvedValue(result)

    fireEvent.click(renderCard())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })
})
