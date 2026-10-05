import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveEvent, uploadEventLogo } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { logger } from '@/lib/logger'
import { revalidatePath, updateTag } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update', 'delete', 'insert']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

// sync_event_stages and sync_event_facilities are both plain RPC calls now
// (REL-01), so a single blanket rpc mock can no longer distinguish which one
// failed — results are looked up by function name, defaulting to success.
function mockClient(
  fromMock: ReturnType<typeof vi.fn>,
  rpcResults: Partial<Record<'sync_event_stages' | 'sync_event_facilities', unknown>> = {}
) {
  const rpcMock = vi.fn((fn: string) =>
    Promise.resolve(
      rpcResults[fn as 'sync_event_stages' | 'sync_event_facilities'] ?? { error: null }
    )
  )
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: fromMock,
    rpc: rpcMock,
  } as never)
  return rpcMock
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'

const RACE_STAGE = {
  name: 'Stage 1',
  stage_type: 'race' as const,
  race_type: 'distance' as const,
  start_time: '2026-06-01T08:00:00Z',
  end_time: '2026-06-01T10:00:00Z',
  venue: 'Start line',
  position: 0,
  distances: [],
}

const NON_RACE_STAGE = {
  ...RACE_STAGE,
  name: 'Info stage',
  stage_type: 'non_race' as const,
}

const BASE_INPUT = {
  tenantSlug: 'viadal',
  tenantId: TENANT_ID,
  eventId: EVENT_ID,
  name: 'Viadal 2026',
  event_type: 'race',
  description: '',
  location: '',
  logo_url: '',
  scheduling_granularity_min: 60,
  stages: [RACE_STAGE],
  facilities: [],
}

function statusBuilderFor(status: 'draft' | 'published' | null, errorMessage?: string) {
  return chain({
    data: status === null ? null : { status },
    error: errorMessage ? { message: errorMessage } : null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('saveEvent', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
      rpc: vi.fn(),
    } as never)

    await expect(saveEvent(BASE_INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error and never touches events when access is denied', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const fromMock = vi.fn()
    mockClient(fromMock)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects a scheduling granularity other than 60 min and never touches events', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const fromMock = vi.fn()
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, scheduling_granularity_min: 90 })

    expect(result).toEqual({ error: 'Scheduling granularity is fixed at 60 minutes.' })
    // The guard runs before the current-event lookup, so nothing is read or written.
    expect(fromMock).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('blocks removing the last Race stage from a published event, before writing anything', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('published')
    const eventUpdateBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(statusBuilder)
      .mockReturnValueOnce(eventUpdateBuilder)
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, stages: [NON_RACE_STAGE] })

    expect(result).toEqual({
      error: 'Cannot remove the last Race stage from a published event.',
    })
    expect(statusBuilder.eq).toHaveBeenCalledWith('id', EVENT_ID)
    expect(statusBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    // The events row update must never run once the guard rejects the save.
    expect(eventUpdateBuilder.update).not.toHaveBeenCalled()
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('blocks emptying all stages from a published event', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('published')
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder)
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, stages: [] })

    expect(result).toEqual({
      error: 'Cannot remove the last Race stage from a published event.',
    })
  })

  // F-REL-22: never forward a raw DB error.message to the client — assert
  // the translated fallback string, not the raw message the mock returns.
  const GENERIC_SAVE_ERROR = 'Something went wrong while saving. Please try again.'

  it('fails closed when the event status cannot be read', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor(null, 'connection reset')
    const eventUpdateBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(statusBuilder)
      .mockReturnValueOnce(eventUpdateBuilder)
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, stages: [NON_RACE_STAGE] })

    expect(result).toEqual({ error: GENERIC_SAVE_ERROR })
    expect(eventUpdateBuilder.update).not.toHaveBeenCalled()
  })

  it('translates the db error and skips sync_event_stages when the events update fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('draft')
    const eventsBuilder = chain({ error: { message: 'events update failed' } })
    const rpcMock = vi.fn()
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: fromMock,
      rpc: rpcMock,
    } as never)

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: GENERIC_SAVE_ERROR })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('translates the rpc error and skips facility sync when sync_event_stages fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('draft')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    const rpcMock = mockClient(fromMock, {
      sync_event_stages: { error: { message: 'stage sync failed' } },
    })

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: GENERIC_SAVE_ERROR })
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(rpcMock).not.toHaveBeenCalledWith('sync_event_facilities', expect.anything())
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('translates P0003 to the Race-stage-specific message from sync_event_stages', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('published')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    mockClient(fromMock, {
      sync_event_stages: { error: { code: 'P0003', message: 'raw pg message' } },
    })

    const result = await saveEvent({ ...BASE_INPUT, stages: [RACE_STAGE] })

    expect(result).toEqual({
      error: 'Cannot remove the last Race stage from a published event.',
    })
  })

  // REL-01: facilities are now replaced atomically via the
  // sync_event_facilities RPC (migration 20260908131614) instead of a
  // separate delete + insert — see
  // tests/integration/sync-event-facilities-atomicity.test.ts for the
  // real-Postgres proof that a partial failure rolls back both statements.
  it('translates the rpc error and skips revalidation when sync_event_facilities fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('draft')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    mockClient(fromMock, {
      sync_event_facilities: { error: { message: 'facility sync failed' } },
    })

    const result = await saveEvent(BASE_INPUT)

    expect(result).toEqual({ error: GENERIC_SAVE_ERROR })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('allows removing the Race stage from a draft event, revalidates, and invalidates all three Group 1 cache tags', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('draft')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, stages: [NON_RACE_STAGE] })

    expect(result).toEqual({})
    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/dashboard')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-event-info`)
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-event`)
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })

  it('allows editing a published event when a Race stage remains', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('published')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    mockClient(fromMock)

    const result = await saveEvent({ ...BASE_INPUT, stages: [RACE_STAGE, NON_RACE_STAGE] })

    expect(result).toEqual({})
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
  })

  it('calls sync_event_facilities with the filtered, re-positioned facilities payload', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const statusBuilder = statusBuilderFor('draft')
    const eventsBuilder = chain({ error: null })
    const fromMock = vi.fn().mockReturnValueOnce(statusBuilder).mockReturnValueOnce(eventsBuilder)
    const rpcMock = mockClient(fromMock)

    const result = await saveEvent({
      ...BASE_INPUT,
      facilities: [
        { label: 'Water station', position: 0 },
        { label: '   ', position: 1 },
        { label: 'Medical tent', position: 5 },
      ],
    })

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith('sync_event_facilities', {
      p_event_id: EVENT_ID,
      p_tenant_id: TENANT_ID,
      p_facilities: [
        { label: 'Water station', position: 0 },
        { label: 'Medical tent', position: 1 },
      ],
    })
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
  })
})

// Builds the storage half of the mocked Supabase client. uploadEventLogo is
// the only action here that touches Storage, so this stays separate from
// mockClient rather than widening it for the saveEvent cases.
function mockStorageClient({
  uploadError = null,
  removeError = null,
  publicUrl = 'https://cdn.example.test/storage/v1/object/public/logos/new.webp',
  user = { id: 'user-1' } as { id: string } | null,
}: {
  uploadError?: { message: string } | null
  removeError?: { message: string } | null
  publicUrl?: string
  user?: { id: string } | null
} = {}) {
  const upload = vi.fn().mockResolvedValue({ error: uploadError })
  const remove = vi.fn().mockResolvedValue({ error: removeError })
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl } }))
  const from = vi.fn(() => ({ upload, remove, getPublicUrl }))

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    storage: { from },
  } as never)

  return { from, upload, remove, getPublicUrl }
}

function logoFormData({
  file = new File(['x'], 'logo.webp', { type: 'image/webp' }) as unknown,
  tenantId = TENANT_ID,
  eventId = EVENT_ID,
  oldLogoUrl,
}: {
  file?: unknown
  tenantId?: string | null
  eventId?: string | null
  oldLogoUrl?: string
} = {}) {
  const fd = new FormData()
  if (file !== undefined && file !== null) fd.append('file', file as string | Blob)
  if (tenantId !== null) fd.append('tenantId', tenantId)
  if (eventId !== null) fd.append('eventId', eventId)
  if (oldLogoUrl !== undefined) fd.append('oldLogoUrl', oldLogoUrl)
  return fd
}

// A File whose size clears MAX_LOGO_BYTES (900 kB) without allocating a real
// megabyte buffer in every run.
function oversizedFile() {
  const file = new File(['x'], 'big.webp', { type: 'image/webp' })
  Object.defineProperty(file, 'size', { value: 900 * 1024 + 1 })
  return file
}

describe('uploadEventLogo', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    mockStorageClient({ user: null })

    await expect(uploadEventLogo(logoFormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('rejects a non-File value in formData', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData({ file: 'not-a-file' }))

    expect(result).toEqual({ error: 'No file provided' })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a non-image content type', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(
      logoFormData({ file: new File(['%PDF'], 'logo.pdf', { type: 'application/pdf' }) })
    )

    expect(result).toEqual({ error: 'Please choose an image file' })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a file over the 900 kB Server Action body cap', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData({ file: oversizedFile() }))

    expect(result).toEqual({ error: 'Image must be smaller than 900 kB' })
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a missing tenantId', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData({ tenantId: null }))

    expect(result).toEqual({ error: 'Missing tenant or event ID' })
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('rejects a missing eventId', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData({ eventId: null }))

    expect(result).toEqual({ error: 'Missing tenant or event ID' })
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })

  // A non-UUID tenantId is a malformed request rather than an ordinary miss,
  // so it must be logged as well as rejected — the client never sends one
  // through the normal flow.
  it('rejects a tenantId that fails tenantIdSchema and logs the attempt', async () => {
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData({ tenantId: 'not-a-uuid' }))

    expect(result).toEqual({ error: 'Missing tenant or event ID' })
    expect(logger.warn).toHaveBeenCalledWith('uploadEventLogo: invalid tenantId', {
      tenantId: 'not-a-uuid',
    })
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
    expect(storage.upload).not.toHaveBeenCalled()
  })

  it('returns Not authorized and never uploads when the user has no admin access', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData())

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(storage.upload).not.toHaveBeenCalled()
  })

  // F-REL-22: the raw Storage error.message must not reach the client.
  it('translates a storage upload error instead of forwarding it', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const storage = mockStorageClient({ uploadError: { message: 'bucket quota exceeded' } })

    const result = await uploadEventLogo(logoFormData())

    expect(result).toEqual({
      error: 'Something went wrong while uploading the logo. Please try again.',
    })
    expect(storage.remove).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('uploadEventLogo: storage upload failed', undefined, {
      message: 'bucket quota exceeded',
    })
  })

  it('returns the public URL and uploads under tenant/event with the file content type', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const storage = mockStorageClient()

    const result = await uploadEventLogo(logoFormData())

    expect(result).toEqual({
      publicUrl: 'https://cdn.example.test/storage/v1/object/public/logos/new.webp',
    })
    expect(storage.from).toHaveBeenCalledWith('logos')
    const [path, file, options] = storage.upload.mock.calls[0]
    expect(path).toMatch(new RegExp(`^${TENANT_ID}/${EVENT_ID}/\\d+\\.webp$`))
    expect(file).toBeInstanceOf(File)
    expect(options).toEqual({ contentType: 'image/webp' })
    // No previous logo was supplied, so there is nothing to clean up.
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('falls back to a jpg extension when the filename has none', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const storage = mockStorageClient()

    await uploadEventLogo(logoFormData({ file: new File(['x'], 'logo', { type: 'image/jpeg' }) }))

    expect(storage.upload.mock.calls[0][0]).toMatch(
      new RegExp(`^${TENANT_ID}/${EVENT_ID}/\\d+\\.jpg$`)
    )
  })

  it('removes the old logo path on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const storage = mockStorageClient()

    const result = await uploadEventLogo(
      logoFormData({
        oldLogoUrl: `https://cdn.example.test/storage/v1/object/public/logos/${TENANT_ID}/${EVENT_ID}/old.webp`,
      })
    )

    expect(result.publicUrl).toBeDefined()
    expect(storage.remove).toHaveBeenCalledWith([`${TENANT_ID}/${EVENT_ID}/old.webp`])
  })

  // Cleanup is best-effort: a failed removal leaves an orphaned object but
  // must never turn a successful upload into an error for the admin.
  it('still returns the public URL when removing the old logo fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const storage = mockStorageClient({ removeError: { message: 'object not found' } })

    const result = await uploadEventLogo(
      logoFormData({
        oldLogoUrl: `https://cdn.example.test/storage/v1/object/public/logos/${TENANT_ID}/${EVENT_ID}/old.webp`,
      })
    )

    expect(result).toEqual({
      publicUrl: 'https://cdn.example.test/storage/v1/object/public/logos/new.webp',
    })
    expect(storage.remove).toHaveBeenCalled()
  })

  // extractStoragePath is module-private, so it is exercised through the
  // cleanup branch it feeds: no bucket marker => null => no remove call.
  describe('extractStoragePath (via old-logo cleanup)', () => {
    it('skips cleanup for a URL without the bucket marker', async () => {
      vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
      const storage = mockStorageClient()

      const result = await uploadEventLogo(
        logoFormData({ oldLogoUrl: 'https://example.test/some/other/logo.webp' })
      )

      expect(result.publicUrl).toBeDefined()
      expect(storage.remove).not.toHaveBeenCalled()
    })

    it('skips cleanup for a URL in a different bucket', async () => {
      vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
      const storage = mockStorageClient()

      await uploadEventLogo(
        logoFormData({
          oldLogoUrl: 'https://cdn.example.test/storage/v1/object/public/avatars/tenant/old.webp',
        })
      )

      expect(storage.remove).not.toHaveBeenCalled()
    })

    it('decodes a percent-encoded path before removing it', async () => {
      vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
      const storage = mockStorageClient()

      await uploadEventLogo(
        logoFormData({
          oldLogoUrl:
            'https://cdn.example.test/storage/v1/object/public/logos/tenant/event/my%20logo%20%281%29.webp',
        })
      )

      expect(storage.remove).toHaveBeenCalledWith(['tenant/event/my logo (1).webp'])
    })
  })
})
