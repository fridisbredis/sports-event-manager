import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

// This file exists to pin the ordering established by commit 2f869d4: both
// exemption blocks (health check, cron) in src/proxy.ts must run BEFORE
// createServerClient() is constructed, because that constructor throws on
// a missing/malformed NEXT_PUBLIC_SUPABASE_* env var. If the exemption
// blocks were ever moved below the client construction, a bad env var
// would 503 the Azure liveness probe instead of the app restarting cleanly
// — the exact failure mode 2f869d4 fixed.
//
// The throwing mock below cannot live in the same module scope as the
// non-throwing @supabase/ssr mock in proxy.test.ts, because vi.mock is
// hoisted and applies per-module for the whole file — hence a separate
// test file rather than a second case in proxy.test.ts.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => {
    throw new Error("Your project's URL and API key are required to create a Supabase client!")
  }),
}))

import { proxy } from './proxy'

function requestFor(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`)
}

describe('proxy — exemption ordering vs. Supabase client construction (regression guard, commit 2f869d4)', () => {
  it('returns 200 for /api/health/live even when createServerClient throws', async () => {
    const res = await proxy(requestFor('/api/health/live'))

    expect(res.status).toBe(200)
  })

  it('returns 200 for /api/health even when createServerClient throws', async () => {
    const res = await proxy(requestFor('/api/health'))

    expect(res.status).toBe(200)
  })

  // Control case: proves the throwing mock is actually wired up and
  // actually reached. A non-exempt path is NOT protected by the exemption
  // blocks, so the throw propagates out of proxy() uncaught — this is the
  // honest expectation given the current code, not a claim that the
  // non-exempt path degrades gracefully. Without this case, the two 200s
  // above could pass trivially on a mock that never actually throws.
  it('control: propagates the throw for a non-exempt path', async () => {
    await expect(proxy(requestFor('/api/tenants'))).rejects.toThrow()
  })
})
