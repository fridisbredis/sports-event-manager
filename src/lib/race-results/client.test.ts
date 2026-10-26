import { describe, expect, it, vi } from 'vitest'

import configFixture from './__fixtures__/config-361004.json'
import listFixture from './__fixtures__/list-361004.json'
import { fetchParticipants, type FetchLike } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * A fetch stub that answers the config call and the list call, recording
 * the URLs it was given so the two-step contract can be asserted.
 */
function stubApi(overrides: { config?: unknown; list?: unknown; listStatus?: number } = {}) {
  const calls: string[] = []
  const fetchImpl: FetchLike = vi.fn(async (url: string) => {
    calls.push(url)
    if (url.includes('/config')) return jsonResponse(overrides.config ?? configFixture)
    return jsonResponse(overrides.list ?? listFixture, overrides.listStatus ?? 200)
  })
  return { fetchImpl, calls }
}

describe('fetchParticipants', () => {
  it('returns the participants from a real pair of responses', async () => {
    const { fetchImpl } = stubApi()

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.participants).toHaveLength(6)
    expect(result.eventName).toBe('Viadal Ultra Six Days 2026')
    expect(result.skipped).toBe(0)
  })

  it('sends the list request to the server named in the config, not the config host', async () => {
    // The spike recorded my4 on 2026-10-15; the same event answered my2 on
    // 2026-10-26. The owning server moves, so it is read from the response
    // every time. Getting this wrong means a redirect chase or a failure.
    const { fetchImpl, calls } = stubApi()

    await fetchParticipants('361004', fetchImpl)

    expect(calls[0]).toContain('my.raceresult.com')
    expect(calls[1]).toContain('my2.raceresult.com')
  })

  it('passes the key from the config on the list request', async () => {
    // Omitting it returns {"error":"no key given"} with a 200 — a failure
    // that does not look like one.
    const { fetchImpl, calls } = stubApi()

    await fetchParticipants('361004', fetchImpl)

    expect(calls[1]).toContain(`key=${configFixture.key}`)
  })

  it('uses the list name from the config rather than a hard-coded one', async () => {
    // 'Online|Deltagare' is Viadal's Swedish list name. A race configured in
    // another language has a different one, and hard-coding would fetch
    // nothing for it.
    const { fetchImpl, calls } = stubApi({
      config: { ...configFixture, lists: [{ Name: 'Online|Entries', ID: 'X' }] },
    })

    await fetchParticipants('361004', fetchImpl)

    expect(calls[1]).toContain(encodeURIComponent('Online|Entries'))
  })

  it('follows redirects, since my. answers 301', async () => {
    const { fetchImpl } = stubApi()

    await fetchParticipants('361004', fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/config'),
      expect.objectContaining({ redirect: 'follow' })
    )
  })

  it('reports an API error payload returned with a 200', async () => {
    // The documented shape of a rejected call. Treating it as an empty list
    // would import zero participants and call it success.
    const { fetchImpl } = stubApi({ list: { error: 'no key given' } })

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('api_error')
    expect(result.message).toContain('no key given')
  })

  it('reports an HTTP failure rather than throwing', async () => {
    const { fetchImpl } = stubApi({ listStatus: 503 })

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('http')
  })

  it('reports a network failure rather than throwing', async () => {
    // F-REL-10: a thrown error here would render the import dialog empty
    // with no explanation.
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('network')
  })

  it('reports a non-JSON response rather than throwing', async () => {
    const fetchImpl: FetchLike = vi.fn(
      async () => new Response('<html>maintenance</html>', { status: 200 })
    )

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('malformed')
  })

  it('reports a config carrying no key', async () => {
    const { fetchImpl } = stubApi({ config: { ...configFixture, key: undefined } })

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('malformed')
  })

  it('reports an event that exposes no participant list', async () => {
    const { fetchImpl } = stubApi({ config: { ...configFixture, lists: [] } })

    const result = await fetchParticipants('361004', fetchImpl)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('no_list')
  })

  it('never makes the list request when the config call fails', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      calls.push(url)
      return jsonResponse({ error: 'event not found' })
    })

    const result = await fetchParticipants('999999', fetchImpl)

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
