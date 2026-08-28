import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logAuditEvent } from './log-audit-event'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function mockInsert(result: { error: unknown }) {
  const insert = vi.fn().mockResolvedValue(result)
  const from = vi.fn(() => ({ insert }))
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never)
  return { from, insert }
}

const BASE_INPUT = {
  tenantId: 'tenant-1',
  actorUserId: 'user-1',
  actorRole: 'tenant_admin' as const,
  action: 'official_invited' as const,
  targetType: 'official' as const,
  targetId: 'off-1',
  detail: { phoneLast4: '1234' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logAuditEvent', () => {
  it('inserts a row with the expected shape', async () => {
    const { from, insert } = mockInsert({ error: null })

    await logAuditEvent(BASE_INPUT)

    expect(from).toHaveBeenCalledWith('audit_events')
    expect(insert).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      actor_user_id: 'user-1',
      actor_role: 'tenant_admin',
      action: 'official_invited',
      target_type: 'official',
      target_id: 'off-1',
      detail: { phoneLast4: '1234' },
    })
  })

  it('defaults targetId to null and detail to {} when omitted', async () => {
    const { insert } = mockInsert({ error: null })

    await logAuditEvent({
      tenantId: null,
      actorUserId: 'user-1',
      actorRole: 'system_admin',
      action: 'tenant_created',
      targetType: 'tenant',
    })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ target_id: null, detail: {} }))
  })

  it('logs via logger.error and does not throw when the insert returns an error', async () => {
    mockInsert({ error: { message: 'permission denied', code: '42501' } })

    await expect(logAuditEvent(BASE_INPUT)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to write audit event',
      { message: 'permission denied', code: '42501' },
      { action: 'official_invited', tenantId: 'tenant-1' }
    )
  })

  it('logs via logger.error and does not throw when the client construction itself throws', async () => {
    vi.mocked(createSupabaseServerClient).mockRejectedValue(new Error('boom'))

    await expect(logAuditEvent(BASE_INPUT)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'Audit event write threw unexpectedly',
      expect.any(Error),
      { action: 'official_invited', tenantId: 'tenant-1' }
    )
  })
})
