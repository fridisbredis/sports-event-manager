import { describe, it, expect, vi, beforeEach } from 'vitest'

import { avatarFolder, removeExpiredAvatars } from './avatar-cleanup'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

interface Row {
  row_kind: string
  row_id: string
  row_tenant_id: string
  avatar_url: string
}

function updateChain(result: { error: unknown }) {
  const calls: [string, unknown][] = []
  const builder: Record<string, unknown> = {}
  builder.update = vi.fn(() => builder)
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
  files = {},
  listError = null,
  removeError = null,
  updateError = null,
}: {
  rows?: Row[]
  rpcError?: unknown
  files?: Record<string, string[]>
  listError?: unknown
  removeError?: unknown
  updateError?: unknown
}) {
  const list = vi.fn(async (folder: string, opts: { limit: number; offset: number }) => {
    if (listError) return { data: null, error: listError }
    const names = files[folder] ?? []
    return {
      data: names.slice(opts.offset, opts.offset + opts.limit).map((name) => ({ name })),
      error: null,
    }
  })
  const remove = vi.fn(async () => ({ data: [], error: removeError }))
  const updates: { table: string; calls: [string, unknown][]; builder: Record<string, unknown> }[] =
    []
  const from = vi.fn((table: string) => {
    const { builder, calls } = updateChain({ error: updateError })
    updates.push({ table, calls, builder })
    return builder
  })
  const service = {
    rpc: vi.fn(async () => ({ data: rpcError ? null : (rows ?? []), error: rpcError })),
    storage: { from: vi.fn(() => ({ list, remove })) },
    from,
  }
  return { service, list, remove, updates }
}

const official: Row = {
  row_kind: 'official',
  row_id: 'o1',
  row_tenant_id: 't1',
  avatar_url: 'https://x/storage/v1/object/public/avatars/t1/o1/2.webp',
}
const participant: Row = {
  row_kind: 'participant',
  row_id: 'p1',
  row_tenant_id: 't1',
  avatar_url: 'https://x/storage/v1/object/public/avatars/t1/participants/p1/5.jpg',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('avatarFolder', () => {
  it('maps each row kind to the folder its upload code writes to', () => {
    expect(avatarFolder('official', 't1', 'o1')).toBe('t1/o1')
    expect(avatarFolder('participant', 't1', 'p1')).toBe('t1/participants/p1')
    expect(avatarFolder('something-else', 't1', 'x')).toBeNull()
  })
})

describe('removeExpiredAvatars', () => {
  it('removes every file in the row folder, then clears the URL it listed', async () => {
    const { service, remove, updates } = serviceWith({
      rows: [official, participant],
      files: { 't1/o1': ['1.jpg', '2.webp'], 't1/participants/p1': ['5.jpg'] },
    })

    const result = await removeExpiredAvatars(service as never)

    expect(result).toEqual({ cleared: 2, failed: 0, listFailed: false })
    expect(remove).toHaveBeenCalledWith(['t1/o1/1.jpg', 't1/o1/2.webp'])
    expect(remove).toHaveBeenCalledWith(['t1/participants/p1/5.jpg'])
    expect(updates.map((u) => u.table)).toEqual(['officials', 'participants'])
    expect(updates[0].builder.update).toHaveBeenCalledWith({ avatar_url: null })
    expect(updates[0].calls).toEqual([
      ['id', 'o1'],
      ['tenant_id', 't1'],
      ['avatar_url', official.avatar_url],
    ])
  })

  it('pages through a folder with more files than one list call returns', async () => {
    const many = Array.from({ length: 150 }, (_, i) => `${i}.jpg`)
    const { service, list, remove } = serviceWith({ rows: [official], files: { 't1/o1': many } })

    await removeExpiredAvatars(service as never)

    expect(list).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith(many.map((name) => `t1/o1/${name}`))
  })

  it('still clears the URL when the folder is already empty', async () => {
    const { service, remove, updates } = serviceWith({ rows: [official] })

    const result = await removeExpiredAvatars(service as never)

    expect(remove).not.toHaveBeenCalled()
    expect(updates).toHaveLength(1)
    expect(result.cleared).toBe(1)
  })

  it('keeps the URL when the files could not be removed, so the next run retries', async () => {
    const { service, updates } = serviceWith({
      rows: [official],
      files: { 't1/o1': ['1.jpg'] },
      removeError: { message: 'storage down' },
    })

    const result = await removeExpiredAvatars(service as never)

    expect(updates).toHaveLength(0)
    expect(result).toEqual({ cleared: 0, failed: 1, listFailed: false })
  })

  it('keeps the URL when the folder could not be listed', async () => {
    const { service, remove, updates } = serviceWith({
      rows: [official],
      listError: { message: 'storage down' },
    })

    const result = await removeExpiredAvatars(service as never)

    expect(remove).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
    expect(result.failed).toBe(1)
  })

  it('counts a failed URL update as failed', async () => {
    const { service } = serviceWith({
      rows: [official],
      files: { 't1/o1': ['1.jpg'] },
      updateError: { message: 'nope' },
    })

    expect(await removeExpiredAvatars(service as never)).toEqual({
      cleared: 0,
      failed: 1,
      listFailed: false,
    })
  })

  it('attempts nothing when the candidate list cannot be read', async () => {
    const { service, list } = serviceWith({ rpcError: { message: 'rpc failed' } })

    const result = await removeExpiredAvatars(service as never)

    expect(list).not.toHaveBeenCalled()
    expect(result).toEqual({ cleared: 0, failed: 0, listFailed: true })
  })

  it('skips an unknown row kind instead of guessing a folder', async () => {
    const { service, list } = serviceWith({ rows: [{ ...official, row_kind: 'admin' }] })

    const result = await removeExpiredAvatars(service as never)

    expect(list).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
  })
})
