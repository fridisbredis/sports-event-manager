// ADR-0005 §7: an official opens the tournament app from Viadal. Client side.
//
// The app opens in its own tab, with this tab as its window.opener. It gets a
// first token in the address fragment (/viadal#token=…), and asks this tab for
// the next ones by postMessage, so this tab answers for as long as it is open
// (TournamentTokenResponder in the official layout). Both directions are
// checked against the other side's exact origin, and this side answers only
// the window it opened itself.
//
// Messages, as the tournament app defines them (web/src/app/core/viadal-session.ts):
// - from the app: { type: 'tournament-token-request' }
// - to the app:   { type: 'tournament-token', token: string }

export const TOKEN_REQUEST = 'tournament-token-request'
export const TOKEN_MESSAGE = 'tournament-token'

/** Reused, so opening tournaments twice brings the same tab back instead of a second one. */
const WINDOW_NAME = 'viadal-tournaments'

type TokenResponse = { token: string; expiresAt: string }

export type OpenResult = 'opened' | 'popup-blocked' | 'forbidden' | 'unavailable'

/** The window this tab opened and the event it was opened for; null until then, and after a reload of this tab. */
let opened: { window: Window; tenantSlug: string; eventId: string } | null = null

/** For tests. */
export function resetOpenedTournaments(): void {
  opened = null
}

async function fetchToken(tenantSlug: string, eventId: string): Promise<TokenResponse | number> {
  const response = await fetch('/api/tournament-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug, eventId }),
  })
  if (!response.ok) return response.status
  return (await response.json()) as TokenResponse
}

/**
 * Opens the tournament app for one event. Must be called straight from the
 * click: the tab is opened before the token is fetched, because browsers block
 * a window.open that follows an await. It shows a blank page for the moment
 * the token takes, then the app.
 */
export async function openTournaments(
  appUrl: string,
  tenantSlug: string,
  eventId: string
): Promise<OpenResult> {
  const target = window.open('about:blank', WINDOW_NAME)
  if (!target) return 'popup-blocked'

  let result: TokenResponse | number
  try {
    result = await fetchToken(tenantSlug, eventId)
  } catch {
    result = 0
  }
  if (typeof result === 'number') {
    target.close()
    return result === 403 ? 'forbidden' : 'unavailable'
  }

  opened = { window: target, tenantSlug, eventId }
  // The fragment never reaches a server or its logs; the app takes it out of
  // the address before anything else runs.
  target.location.href = `${appUrl}/viadal#token=${encodeURIComponent(result.token)}`
  return 'opened'
}

/**
 * Answers the tournament app's request for a new token, or ignores the
 * message. Only from the window this tab opened, at the app's exact origin,
 * and only for the event it was opened for.
 */
export async function answerTokenRequest(event: MessageEvent, appOrigin: string): Promise<void> {
  if (!opened || event.origin !== appOrigin || event.source !== opened.window) return
  const data = event.data as { type?: unknown } | null
  if (data?.type !== TOKEN_REQUEST) return

  const { window: target, tenantSlug, eventId } = opened
  let result: TokenResponse | number
  try {
    result = await fetchToken(tenantSlug, eventId)
  } catch {
    return
  }
  // No answer on a refusal: the app waits, then sends the official back here
  // to open it again, which shows why.
  if (typeof result === 'number') return
  target.postMessage({ type: TOKEN_MESSAGE, token: result.token }, appOrigin)
}
