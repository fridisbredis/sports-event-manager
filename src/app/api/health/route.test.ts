import { describe, it, expect, vi, afterEach } from 'vitest'
import { GET } from './route'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.limit = vi.fn(() => Promise.resolve(result))
  return builder
}

let restoreConsoleError: (() => void) | undefined

afterEach(() => {
  restoreConsoleError?.()
  restoreConsoleError = undefined
})

describe('GET /api/health', () => {
  it('returns 200 and ok when the database is reachable', async () => {
    const fromMock = vi.fn(() => chain({ data: [{ id: 'tenant-1' }], error: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok', database: 'reachable' })
  })

  it('returns 503 and logs when the database query fails', async () => {
    const fromMock = vi.fn(() => chain({ data: null, error: { message: 'connection refused' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toEqual({ status: 'error', database: 'unreachable' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'))
  })
})
