import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// No authenticated user for any case in this file — every test below
// exercises the exemption logic, not the auth-refresh mechanics.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
    },
  })),
}))

import { proxy } from './proxy'

function requestFor(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`)
}

describe('proxy — health check auth exemption', () => {
  it('passes /api/health/live through without auth', async () => {
    const res = await proxy(requestFor('/api/health/live'))

    expect(res.status).not.toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  it('passes /api/health through without auth (regression guard, F-REL-02)', async () => {
    const res = await proxy(requestFor('/api/health'))

    expect(res.status).not.toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  // Control case — without this, the two cases above could pass trivially
  // on a broken mock (e.g. one that always skips the auth check). This
  // proves the same unauthenticated request IS blocked on a path that
  // isn't exempted.
  it('control: blocks an unexempted API path with 401', async () => {
    const res = await proxy(requestFor('/api/tenants'))

    expect(res.status).toBe(401)
  })

  // Pins the exact-match decision itself. /api/tenants (above) only proves
  // the mock isn't broken — it says nothing about /api/health specifically.
  // This case proves the exemption is an exact-path list, not a prefix
  // match: if the condition were ever widened to
  // pathname.startsWith('/api/health'), this unlisted sibling path would
  // wrongly become exempt and this test would catch it.
  it('control: does not exempt an unlisted /api/health/* path', async () => {
    const res = await proxy(requestFor('/api/health/detail'))

    expect(res.status).toBe(401)
  })
})

describe('proxy — cron auth exemption', () => {
  // Cron routes (pg_cron/pg_net, migration 0029) have no Supabase session
  // cookie and authenticate via CRON_SECRET inside the route handler
  // itself, so proxy-level auth must be skipped for them — mirrors the
  // health check exemption above, moved above createServerClient() in the
  // same commit (2f869d4) for the same reason.
  it('passes /api/cron/anonymize through without auth', async () => {
    const res = await proxy(requestFor('/api/cron/anonymize'))

    expect(res.status).not.toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })

  // Pins the trailing-slash boundary of the startsWith('/api/cron/') check:
  // a bare /api/cron (no trailing slash) is NOT exempt and falls through to
  // the generic /api/ 401 branch. Without this case, a future change from
  // startsWith('/api/cron/') to something looser (or the reverse — an
  // accidental exact-match on '/api/cron/anonymize' only) could go
  // unnoticed either way.
  it('control: does not exempt the bare /api/cron path (no trailing slash)', async () => {
    const res = await proxy(requestFor('/api/cron'))

    expect(res.status).toBe(401)
  })
})
