import { describe, it, expect, vi, beforeEach } from 'vitest'

import { removeExpiredFeedback } from './feedback-cleanup'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface Row {
  feedback_id: string
  feedback_tenant_id: string
  image_path: string | null
}

function deleteChain(result: { error: unknown }) {
  const calls: [string, unknown][] = []
  const builder: Record<string, unknown> = {}
  builder.delete = vi.fn(() => builder)
  builder.eq = vi.fn((column: string, value: unknown) => {
    calls.push([column, value])
    return builder
  })
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return { builder, calls }
}

function serviceWith({
  rows,
  rpcError = null,
  removeError = null,
  deleteError = null,
}: {
  rows?: Row[]
  rpcError?: unknown
  removeError?: unknown
  deleteError?: unknown
}) {
  const remove = vi.fn(async () => ({ data: [], error: removeError }))
  const storageFrom = vi.fn(() => ({ remove }))
  const deletes: { table: string; calls: [string, unknown][]; builder: Record<string, unknown> }[] =
    []
  const from = vi.fn((table: string) => {
    const { builder, calls } = deleteChain({ error: deleteError })
    deletes.push({ table, calls, builder })
    return builder
  })
  const service = {
    rpc: vi.fn(async () => ({ data: rpcError ? null : (rows ?? []), error: rpcError })),
    storage: { from: storageFrom },
    from,
  }
  return { service, storageFrom, remove, deletes }
}

const withImage: Row = {
  feedback_id: 'f1',
  feedback_tenant_id: 't1',
  image_path: 't1/u1/f1/screenshot.png',
}
const withoutImage: Row = { feedback_id: 'f2', feedback_tenant_id: 't1', image_path: null }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('removeExpiredFeedback', () => {
  it('removes the image from the feedback bucket, then deletes the row', async () => {
    const { service, storageFrom, remove, deletes } = serviceWith({ rows: [withImage] })

    const result = await removeExpiredFeedback(service as never)

    expect(service.rpc).toHaveBeenCalledWith('list_gdpr_feedback_cleanup')
    expect(storageFrom).toHaveBeenCalledWith('feedback-images')
    expect(remove).toHaveBeenCalledWith(['t1/u1/f1/screenshot.png'])
    expect(deletes).toHaveLength(1)
    expect(deletes[0].table).toBe('feedback')
    expect(deletes[0].builder.delete).toHaveBeenCalled()
    expect(deletes[0].calls).toEqual([
      ['id', 'f1'],
      ['tenant_id', 't1'],
    ])
    expect(result).toEqual({ deleted: 1, failed: 0, listFailed: false })
  })

  it('deletes a row without an image without calling storage', async () => {
    const { service, remove, deletes } = serviceWith({ rows: [withoutImage] })

    const result = await removeExpiredFeedback(service as never)

    expect(remove).not.toHaveBeenCalled()
    expect(deletes).toHaveLength(1)
    expect(result.deleted).toBe(1)
  })

  it('keeps the row when its image could not be removed, so the next run retries', async () => {
    const { service, deletes } = serviceWith({
      rows: [withImage],
      removeError: { message: 'storage down' },
    })

    const result = await removeExpiredFeedback(service as never)

    expect(deletes).toHaveLength(0)
    expect(result).toEqual({ deleted: 0, failed: 1, listFailed: false })
  })

  it('carries on with the next row after one fails', async () => {
    const { service, remove, deletes } = serviceWith({ rows: [withImage, withoutImage] })
    remove.mockResolvedValueOnce({ data: [], error: { message: 'storage down' } })

    const result = await removeExpiredFeedback(service as never)

    expect(deletes.map((d) => d.calls[0])).toEqual([['id', 'f2']])
    expect(result).toEqual({ deleted: 1, failed: 1, listFailed: false })
  })

  it('counts a failed row delete as failed', async () => {
    const { service } = serviceWith({ rows: [withImage], deleteError: { message: 'nope' } })

    expect(await removeExpiredFeedback(service as never)).toEqual({
      deleted: 0,
      failed: 1,
      listFailed: false,
    })
  })

  it('attempts nothing when the candidate list cannot be read', async () => {
    const { service, remove, deletes } = serviceWith({ rpcError: { message: 'rpc failed' } })

    const result = await removeExpiredFeedback(service as never)

    expect(remove).not.toHaveBeenCalled()
    expect(deletes).toHaveLength(0)
    expect(result).toEqual({ deleted: 0, failed: 0, listFailed: true })
  })
})
