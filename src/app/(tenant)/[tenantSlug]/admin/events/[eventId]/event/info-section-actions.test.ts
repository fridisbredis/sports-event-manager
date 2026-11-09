import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveInfoSection, deleteInfoSection, reorderInfoSections } from './info-section-actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { updateTag } from 'next/cache'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/auth/tenant', () => ({ hasAdminAccessToTenant: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const SECTION_ID = '33333333-3333-3333-3333-333333333333'

// A query builder whose every method chains and which resolves to `result`
// wherever the action awaits it.
function chain(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update', 'delete', 'insert', 'order', 'limit']) {
    b[m] = vi.fn(() => b)
  }
  b.single = vi.fn(() => Promise.resolve(result))
  b.maybeSingle = vi.fn(() => Promise.resolve(result))
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

interface Setup {
  /** Results for successive from('event_info_sections') calls, in order. */
  queries?: unknown[]
  uploadError?: unknown
  rpcError?: unknown
}

function setup({ queries = [], uploadError = null, rpcError = null }: Setup = {}) {
  const builders = queries.map(chain)
  let call = 0
  const from = vi.fn(() => builders[call++] ?? chain({ data: null, error: null }))
  const upload = vi.fn().mockResolvedValue({ error: uploadError })
  const remove = vi.fn().mockResolvedValue({ error: null })
  const rpc = vi.fn().mockResolvedValue({ error: rpcError })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
    rpc,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  } as never)
  return { from, builders, upload, remove, rpc }
}

function form(fields: Record<string, string | File>) {
  const fd = new FormData()
  fd.set('tenantId', TENANT_ID)
  fd.set('eventId', EVENT_ID)
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const webp = (bytes = 10) => new File([new Uint8Array(bytes)], 'map.webp', { type: 'image/webp' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
})

describe('saveInfoSection', () => {
  it('refuses a non-admin before touching the database', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const { from } = setup()
    const result = await saveInfoSection(form({ title: 'Parking', body: 'North lot' }))
    expect(result).toEqual({ error: 'Not authorized' })
    expect(from).not.toHaveBeenCalled()
  })

  it('requires a title', async () => {
    setup()
    const result = await saveInfoSection(form({ title: '   ', body: 'x' }))
    expect(result).toEqual({ error: 'Give the section a title.', field: 'title' })
  })

  // L23 — the card's done-criterion.
  it('refuses a section with no text, image or link', async () => {
    const { from } = setup()
    const result = await saveInfoSection(form({ title: 'Parking', body: '  ' }))
    expect(result).toEqual({ error: 'Add text, an image or a link.', field: 'content' })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a non-http link', async () => {
    setup()
    const result = await saveInfoSection(form({ title: 'Live', linkUrl: 'javascript:alert(1)' }))
    expect(result.field).toBe('link')
  })

  it('rejects an image of the wrong type or over the size limit', async () => {
    const { upload } = setup()
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' })
    expect((await saveInfoSection(form({ title: 'Map', image: gif }))).field).toBe('image')
    expect((await saveInfoSection(form({ title: 'Map', image: webp(901 * 1024) }))).field).toBe(
      'image'
    )
    expect(upload).not.toHaveBeenCalled()
  })

  it('adds a link-only section last, with the link normalised', async () => {
    const { builders } = setup({
      queries: [{ data: { position: 2 }, error: null }, { error: null }],
    })
    const result = await saveInfoSection(
      form({ title: 'Live video', linkUrl: 'youtube.com/live', linkLabel: 'Watch' })
    )
    expect(result).toEqual({})
    expect(builders[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        event_id: EVENT_ID,
        position: 3,
        title: 'Live video',
        body: null,
        image_path: null,
        link_url: 'https://youtube.com/live',
        link_label: 'Watch',
      })
    )
    expect(updateTag).toHaveBeenCalled()
  })

  it('uploads a new image under the section id and removes it if the row write fails', async () => {
    const { upload, remove } = setup({
      queries: [{ data: null, error: null }, { error: { code: '23514', message: 'check' } }],
    })
    const result = await saveInfoSection(form({ title: 'Map', image: webp() }))
    expect(result.error).toBeDefined()
    const path = upload.mock.calls[0][0] as string
    expect(path).toMatch(new RegExp(`^${TENANT_ID}/${EVENT_ID}/[0-9a-f-]{36}/\\d+\\.webp$`))
    expect(remove).toHaveBeenCalledWith([path])
  })

  it('replaces an image: old file removed only after the row points at the new one', async () => {
    const oldPath = `${TENANT_ID}/${EVENT_ID}/${SECTION_ID}/1.webp`
    const { builders, upload, remove } = setup({
      queries: [{ data: { image_path: oldPath }, error: null }, { error: null }],
    })
    const result = await saveInfoSection(
      form({ sectionId: SECTION_ID, title: 'Map', image: webp() })
    )
    expect(result).toEqual({})
    const newPath = upload.mock.calls[0][0] as string
    expect(builders[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ image_path: newPath })
    )
    expect(remove).toHaveBeenCalledWith([oldPath])
  })

  it('keeps the current image when the edit does not touch it', async () => {
    const oldPath = `${TENANT_ID}/${EVENT_ID}/${SECTION_ID}/1.webp`
    const { builders, remove } = setup({
      queries: [{ data: { image_path: oldPath }, error: null }, { error: null }],
    })
    await saveInfoSection(form({ sectionId: SECTION_ID, title: 'Map renamed' }))
    expect(builders[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ image_path: oldPath })
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it('refuses removing the only content of a section', async () => {
    const oldPath = `${TENANT_ID}/${EVENT_ID}/${SECTION_ID}/1.webp`
    setup({ queries: [{ data: { image_path: oldPath }, error: null }] })
    const result = await saveInfoSection(
      form({ sectionId: SECTION_ID, title: 'Map', removeImage: '1' })
    )
    expect(result.field).toBe('content')
  })
})

describe('deleteInfoSection', () => {
  it('deletes the row, then its image', async () => {
    const path = `${TENANT_ID}/${EVENT_ID}/${SECTION_ID}/1.webp`
    const { remove } = setup({ queries: [{ data: { image_path: path }, error: null }] })
    expect(await deleteInfoSection(TENANT_ID, EVENT_ID, SECTION_ID)).toEqual({})
    expect(remove).toHaveBeenCalledWith([path])
  })

  it('rejects a malformed id', async () => {
    const { from } = setup()
    const result = await deleteInfoSection(TENANT_ID, EVENT_ID, 'nope')
    expect(result.error).toBeDefined()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('reorderInfoSections', () => {
  it('passes the order to the atomic RPC', async () => {
    const { rpc } = setup()
    expect(await reorderInfoSections(TENANT_ID, EVENT_ID, [SECTION_ID])).toEqual({})
    expect(rpc).toHaveBeenCalledWith('reorder_event_info_sections', {
      p_tenant_id: TENANT_ID,
      p_event_id: EVENT_ID,
      p_ids: [SECTION_ID],
    })
  })

  it('refuses a non-admin', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const { rpc } = setup()
    expect(await reorderInfoSections(TENANT_ID, EVENT_ID, [SECTION_ID])).toEqual({
      error: 'Not authorized',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
