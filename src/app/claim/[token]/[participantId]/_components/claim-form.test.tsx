import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import type { ClaimPrefill } from '@/lib/participants/claim-prefill'

import ClaimForm from './claim-form'

// Keys instead of translations, so assertions name the copy they expect.
const { fakeT, changeLanguage } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  changeLanguage: vi.fn(),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fakeT, i18n: { changeLanguage, language: 'en' } }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
// The language switcher persists through the router and toasts; neither is
// under test here.
vi.mock('@/components/language-switcher', () => ({ LanguageSwitcher: () => null }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function reply(status: number, body: unknown = {}) {
  return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })
}

const PROPS = {
  token: '0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11',
  event: { name: 'Viadal 2026', logoUrl: null },
  participant: { id: '22222222-2222-4222-8222-222222222222', bib: '101', name: 'Lisa Nord' },
  listHref: '/claim/0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11',
}

const EMPTY_PREFILL: ClaimPrefill = {
  existingAccount: false,
  alreadyInEvent: false,
  claimedByYou: false,
  avatarUrl: null,
  ice: null,
  language: null,
}

function completeButton() {
  return screen.getByRole('button', { name: 'claim.complete' })
}

async function sendAndVerify(prefill = EMPTY_PREFILL) {
  fetchMock
    .mockImplementationOnce(() => reply(200, { ok: true })) // send-otp
    .mockImplementationOnce(() => reply(200, { ok: true })) // verify-otp
    .mockImplementationOnce(() => reply(200, { ok: true, prefill })) // prefill

  fireEvent.change(screen.getByLabelText(/claim.phoneLabel/), {
    target: { value: '070 123 45 67' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'claim.sendCode' }))
  const code = await screen.findByLabelText('claim.codeLabel')
  fireEvent.change(code, { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'claim.verify' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
})

describe('ClaimForm (CLAIM-02)', () => {
  it('shows bib and name read-only and keeps Complete disabled until the number is verified', () => {
    render(<ClaimForm {...PROPS} />)

    expect(screen.getByText('101 · Lisa Nord')).toBeInTheDocument()
    expect(completeButton()).toBeDisabled()
  })

  it('sends the code for the normalized number, scoped to this claim', async () => {
    render(<ClaimForm {...PROPS} />)
    fetchMock.mockImplementationOnce(() => reply(200, { ok: true }))

    fireEvent.change(screen.getByLabelText(/claim.phoneLabel/), {
      target: { value: '070-123 45 67' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'claim.sendCode' }))

    await screen.findByLabelText('claim.codeLabel')
    expect(fetchMock).toHaveBeenCalledWith('/api/claim/send-otp', expect.anything())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      token: PROPS.token,
      participantId: PROPS.participant.id,
      phone: '46701234567',
    })
  })

  it('refuses a number in a country we cannot text without calling the server', () => {
    render(<ClaimForm {...PROPS} />)

    fireEvent.change(screen.getByLabelText(/claim.phoneLabel/), {
      target: { value: '+44 7400 123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'claim.sendCode' }))

    expect(screen.getByText('claim.phoneUnsupportedCountry')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the rate-limited message inline (L15)', async () => {
    render(<ClaimForm {...PROPS} />)
    fetchMock.mockImplementationOnce(() => reply(429, { code: 'over_request_rate_limit' }))

    fireEvent.change(screen.getByLabelText(/claim.phoneLabel/), {
      target: { value: '070 123 45 67' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'claim.sendCode' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('claim.rateLimited')
  })

  it('says which box is missing when Complete is pressed without it (checkbox-missing)', async () => {
    render(<ClaimForm {...PROPS} />)
    await sendAndVerify()

    fireEvent.click(screen.getByText('claim.confirmIdentity'))
    fireEvent.click(completeButton())

    expect(screen.getAllByText('claim.required')).toHaveLength(1)
    // No claim was attempted: send, verify and prefill only.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('blocks Complete for a number already linked in this event (L13)', async () => {
    render(<ClaimForm {...PROPS} />)
    await sendAndVerify({ ...EMPTY_PREFILL, existingAccount: true, alreadyInEvent: true })

    expect(await screen.findByRole('alert')).toHaveTextContent('claim.alreadyInEvent')
    expect(completeButton()).toBeDisabled()
    expect(screen.queryByText('claim.welcomeBack')).not.toBeInTheDocument()
  })

  it('welcomes an existing account and prefills its ICE contact (L5)', async () => {
    render(<ClaimForm {...PROPS} />)
    await sendAndVerify({
      ...EMPTY_PREFILL,
      existingAccount: true,
      ice: { phone: '46701112233', name: 'Anna', relation: 'Partner' },
    })

    expect(await screen.findByText('claim.welcomeBack')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Anna')).toBeInTheDocument()
  })

  it('completes with both boxes ticked and shows the completed state', async () => {
    render(<ClaimForm {...PROPS} />)
    await sendAndVerify()
    fetchMock.mockImplementationOnce(() => reply(200, { ok: true, roleGranted: true }))

    fireEvent.click(screen.getByText('claim.confirmIdentity'))
    fireEvent.click(screen.getByText('confirmation.privacyCheckPrefix'))
    fireEvent.click(completeButton())

    expect(await screen.findByText('claim.completedTitle')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[3]
    expect(url).toBe('/api/claim/complete')
    expect(JSON.parse(init.body)).toEqual({
      token: PROPS.token,
      participantId: PROPS.participant.id,
      identityConfirmed: true,
      privacyAccepted: true,
      keepExistingPhoto: false,
    })
  })

  // N42: "This is me" on a record someone else already holds.
  describe('conflict (N42)', () => {
    it('says the record is claimed, offers sign-in, and asks for no photo', () => {
      render(<ClaimForm {...PROPS} conflict />)

      expect(screen.getByText('claim.alreadyClaimedTitle')).toBeInTheDocument()
      expect(screen.getByText('claim.conflictIntro')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'claim.signIn' })).toHaveAttribute('href', '/login')
      expect(screen.queryByRole('button', { name: 'claim.photoAdd' })).not.toBeInTheDocument()
      // The same steps: number first, Complete waits for it.
      expect(completeButton()).toBeDisabled()
    })

    it('ends on the conflict-submitted message, not the completed one', async () => {
      render(<ClaimForm {...PROPS} conflict />)
      await sendAndVerify()
      fetchMock.mockImplementationOnce(() =>
        reply(200, { ok: true, outcome: 'conflict', roleGranted: false })
      )

      fireEvent.click(screen.getByText('claim.confirmIdentity'))
      fireEvent.click(screen.getByText('confirmation.privacyCheckPrefix'))
      fireEvent.click(completeButton())

      expect(await screen.findByText('claim.conflictSubmitted')).toBeInTheDocument()
      expect(screen.queryByText('claim.completedTitle')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'claim.goToMyPage' })).not.toBeInTheDocument()
      // Complete was the last call: no photo upload after a conflict.
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('completes normally when the server says the record is theirs after all', async () => {
      render(<ClaimForm {...PROPS} conflict />)
      await sendAndVerify({ ...EMPTY_PREFILL, existingAccount: true, claimedByYou: true })
      fetchMock.mockImplementationOnce(() =>
        reply(200, { ok: true, outcome: 'claimed', roleGranted: false })
      )

      fireEvent.click(screen.getByText('claim.confirmIdentity'))
      fireEvent.click(screen.getByText('confirmation.privacyCheckPrefix'))
      fireEvent.click(completeButton())

      expect(await screen.findByText('claim.completedTitle')).toBeInTheDocument()
    })

    it('a record claimed while the ordinary form was open also ends as a conflict', async () => {
      render(<ClaimForm {...PROPS} />)
      await sendAndVerify()
      fetchMock.mockImplementationOnce(() =>
        reply(200, { ok: true, outcome: 'conflict', roleGranted: false })
      )

      fireEvent.click(screen.getByText('claim.confirmIdentity'))
      fireEvent.click(screen.getByText('confirmation.privacyCheckPrefix'))
      fireEvent.click(completeButton())

      expect(await screen.findByText('claim.conflictSubmitted')).toBeInTheDocument()
    })
  })
})
