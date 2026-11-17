import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TOKEN_MESSAGE,
  TOKEN_REQUEST,
  answerTokenRequest,
  openTournaments,
  resetOpenedTournaments,
} from './open-tournaments'

const APP = 'https://tournaments.test'
const EVENT = '11111111-1111-4111-8111-111111111111'

type FakeWindow = {
  location: { href: string }
  close: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
}

function fakeWindow(): FakeWindow {
  return { location: { href: 'about:blank' }, close: vi.fn(), postMessage: vi.fn() }
}

function tokenAnswer(token: string) {
  return new Response(JSON.stringify({ token, expiresAt: '2026-11-17T12:15:00.000Z' }), {
    status: 200,
  })
}

function request(source: unknown, origin = APP, data: unknown = { type: TOKEN_REQUEST }) {
  return new MessageEvent('message', { data, origin, source: source as Window })
}

let opened: FakeWindow
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetOpenedTournaments()
  opened = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
  fetchMock = vi.fn().mockResolvedValue(tokenAnswer('first'))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('openTournaments', () => {
  it('opens the tab before fetching the token, then sends it to the app in the fragment', async () => {
    const result = await openTournaments(APP, 'viadal', EVENT)

    expect(result).toBe('opened')
    expect(window.open).toHaveBeenCalledWith('about:blank', 'viadal-tournaments')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tournament-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tenantSlug: 'viadal', eventId: EVENT }),
      })
    )
    expect(opened.location.href).toBe(`${APP}/viadal#token=first`)
  })

  it('says so when the browser blocks the tab, without asking for a token', async () => {
    vi.mocked(window.open).mockReturnValue(null)

    expect(await openTournaments(APP, 'viadal', EVENT)).toBe('popup-blocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'forbidden'],
    [429, 'unavailable'],
    [503, 'unavailable'],
  ])('closes the tab again when the token is refused with %i', async (status, expected) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }))

    expect(await openTournaments(APP, 'viadal', EVENT)).toBe(expected)
    expect(opened.close).toHaveBeenCalled()
    expect(opened.location.href).toBe('about:blank')
  })

  it('closes the tab when the token cannot be fetched at all', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))

    expect(await openTournaments(APP, 'viadal', EVENT)).toBe('unavailable')
    expect(opened.close).toHaveBeenCalled()
  })
})

describe('answerTokenRequest', () => {
  it('sends a new token for the same event to the tab it opened, at its origin', async () => {
    await openTournaments(APP, 'viadal', EVENT)
    fetchMock.mockResolvedValue(tokenAnswer('second'))

    await answerTokenRequest(request(opened), APP)

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/tournament-token',
      expect.objectContaining({
        body: JSON.stringify({ tenantSlug: 'viadal', eventId: EVENT }),
      })
    )
    expect(opened.postMessage).toHaveBeenCalledWith({ type: TOKEN_MESSAGE, token: 'second' }, APP)
  })

  it.each([
    ['another origin', () => request(opened, 'https://evil.test')],
    ['another window', () => request(fakeWindow())],
    ['another message', () => request(opened, APP, { type: 'something-else' })],
  ])('ignores a request from %s', async (_, make) => {
    await openTournaments(APP, 'viadal', EVENT)
    fetchMock.mockClear()

    await answerTokenRequest(make(), APP)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(opened.postMessage).not.toHaveBeenCalled()
  })

  it('answers nothing before it has opened the app', async () => {
    await answerTokenRequest(request(opened), APP)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers nothing when the token is refused, so the app sends the official back here', async () => {
    await openTournaments(APP, 'viadal', EVENT)
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))

    await answerTokenRequest(request(opened), APP)

    expect(opened.postMessage).not.toHaveBeenCalled()
  })
})
