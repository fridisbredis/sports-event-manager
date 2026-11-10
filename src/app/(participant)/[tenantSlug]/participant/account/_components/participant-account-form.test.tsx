import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ParticipantAccountForm } from './participant-account-form'

// Same stand-ins as the official AccountForm test: i18n returns the key, and
// the HeroUI pieces become plain elements jsdom can drive.
const { fakeT } = vi.hoisted(() => ({ fakeT: (key: string) => key }))
vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: fakeT }) }))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))
vi.mock('@/components/language-switcher', () => ({ LanguageSwitcher: () => null }))
vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/form-fields', () => ({
  Input: ({
    label,
    value,
    isReadOnly,
  }: {
    label?: string
    value?: string
    isReadOnly?: boolean
  }) => (
    <label>
      {label}
      <input value={value ?? ''} readOnly={isReadOnly} onChange={() => {}} />
    </label>
  ),
}))
vi.mock('@heroui/react', () => ({
  Switch: ({
    'aria-label': ariaLabel,
    isSelected,
    onValueChange,
  }: {
    'aria-label'?: string
    isSelected?: boolean
    onValueChange?: (v: boolean) => void
  }) => <button aria-label={ariaLabel} onClick={() => onValueChange?.(!isSelected)} />,
}))

const baseProps = {
  tenantId: 't1',
  name: 'Lisa Nord',
  phone: '+46700000000',
  smsOptOut: false,
  iceContact: null,
  myRace: [
    {
      eventId: 'e1',
      eventName: 'Viadal 2026',
      stageNames: ['6dagars'],
      bib: '101',
      category: 'W40',
      raceResultsUrl: 'https://example.test/101',
    },
  ],
  language: 'en' as const,
  officialHref: null,
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ParticipantAccountForm', () => {
  it('shows the Race Results name and the phone read-only', () => {
    render(<ParticipantAccountForm {...baseProps} />)

    const name = screen.getByLabelText('participant.account.nameLabel') as HTMLInputElement
    const phone = screen.getByLabelText('account.phoneLabel') as HTMLInputElement
    expect(name.value).toBe('Lisa Nord')
    expect(name.readOnly).toBe(true)
    expect(phone.readOnly).toBe(true)
  })

  it('shows the race facts and the own results link', () => {
    render(<ParticipantAccountForm {...baseProps} />)

    expect(screen.getByText('6dagars · participant.home.bib 101 · W40')).toBeTruthy()
    expect(screen.getByText('participant.home.myResults').closest('a')?.getAttribute('href')).toBe(
      'https://example.test/101'
    )
  })

  it('writes the SMS switch to the participant route, for this tenant', async () => {
    render(<ParticipantAccountForm {...baseProps} />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('account.smsUpdatesLabel'))
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/account/participant')
    expect(JSON.parse(init.body)).toEqual({ tenantId: 't1', smsOptOut: true })
  })

  it('links to the official shifts only for someone who is also an official', () => {
    const { rerender } = render(<ParticipantAccountForm {...baseProps} />)
    expect(screen.queryByText('participant.account.myShifts')).toBeNull()

    rerender(<ParticipantAccountForm {...baseProps} officialHref="/viadal/events" />)
    expect(
      screen.getByText('participant.account.myShifts').closest('a')?.getAttribute('href')
    ).toBe('/viadal/events')
  })
})
