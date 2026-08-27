import { describe, it, expect } from 'vitest'
import { GET } from './route'

// This endpoint is deliberately DB-free (see route.ts) — no Supabase mock
// is set up here, unlike src/app/api/health/route.test.ts. If a future
// change makes this test need a Supabase mock, that's a signal the
// DB-free property of the endpoint has been broken.
describe('GET /api/health/live', () => {
  it('returns 200 and ok without a database call', async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })
})
