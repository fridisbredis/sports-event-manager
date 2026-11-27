/**
 * @vitest-environment node
 */
// Node, not the default jsdom: NextRequest.formData() builds Node's File, and
// under jsdom the global File is jsdom's own class, so the route's
// `instanceof File` check would see every upload as "no image". The route runs
// in Node in production, so this is also the honest environment for it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
}))

const TENANT_ID = '7f3c1a52-2b8e-4d4a-9c61-0e5b8f2a9d10'
const EVENT_ID = '2b8e4d4a-9c61-4e5b-8f2a-9d107f3c1a52'
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001'

type Setup = {
  user?: { id: string } | null
  roles?: string[]
  rolesError?: unknown
  recentCount?: number
  uploadError?: unknown
  insertError?: unknown
}

function mockClient(setup: Setup = {}) {
  const {
    user = { id: USER_ID },
    roles = ['official'],
    rolesError = null,
    recentCount = 0,
    uploadError = null,
    insertError = null,
  } = setup

  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const upload = vi.fn().mockResolvedValue({ error: uploadError })
  const remove = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'user_roles') {
      const rolesResult = {
        data: rolesError ? null : roles.map((role) => ({ role })),
        error: rolesError,
      }
      return {
        select: () => ({ eq: () => ({ eq: () => Promise.resolve(rolesResult) }) }),
      }
    }
    // feedback: the rate-limit count, then the insert
    return {
      select: () => ({
        eq: () => ({ gte: () => Promise.resolve({ count: recentCount, error: null }) }),
      }),
      insert,
    }
  })

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  } as never)

  return { from, insert, upload, remove }
}

function validFields(): Record<string, string> {
  return {
    tenantId: TENANT_ID,
    eventId: EVENT_ID,
    surface: 'official',
    type: 'bug',
    title: 'The map does not load',
    body: 'On the info page the map stays grey.',
    pagePath: '/club/events/abc/info',
  }
}

function request(fields: Record<string, string>, image?: File) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (image) form.append('image', image)
  return new NextRequest('http://localhost/api/feedback', { method: 'POST', body: form })
}

function png(bytes = 10) {
  return new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/feedback', () => {
  it('returns 401 without a session and touches nothing', async () => {
    const { from, upload } = mockClient({ user: null })

    const res = await POST(request(validFields()))

    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it.each([
    ['an unknown type', { type: 'praise' }],
    ['an unknown surface', { surface: 'system' }],
    ['an empty title', { title: '   ' }],
    ['a title over 120 characters', { title: 'x'.repeat(121) }],
    ['a body over 4000 characters', { body: 'x'.repeat(4001) }],
    ['a full URL as page path', { pagePath: 'https://evil.example/' }],
    ['a tenant id that is not a uuid', { tenantId: 'club' }],
  ])('rejects %s with 400', async (_label, override) => {
    const { insert } = mockClient()

    const res = await POST(request({ ...validFields(), ...override }))

    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects an image of the wrong type before uploading', async () => {
    const { upload } = mockClient()
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })

    const res = await POST(request(validFields(), gif))

    expect(res.status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects an image over 5 MB before uploading', async () => {
    const { upload } = mockClient()

    const res = await POST(request(validFields(), png(5 * 1024 * 1024 + 1)))

    expect(res.status).toBe(413)
    expect(upload).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller holds no role for that surface', async () => {
    const { insert } = mockClient({ roles: ['participant'] })

    const res = await POST(request(validFields()))

    expect(res.status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
  })

  it('returns 429 once the caller has sent the limit within the window', async () => {
    const { insert } = mockClient({ recentCount: 10 })

    const res = await POST(request(validFields()))

    expect(res.status).toBe(429)
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserts a row without an image, with the role taken from the server', async () => {
    const { insert, upload } = mockClient({ roles: ['tenant_admin', 'official'] })

    const res = await POST(request(validFields()))

    expect(res.status).toBe(201)
    expect(upload).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        event_id: EVENT_ID,
        user_id: USER_ID,
        user_role: 'official',
        type: 'bug',
        title: 'The map does not load',
        image_path: null,
      })
    )
  })

  it('stores a missing event as null', async () => {
    const { insert } = mockClient()
    const fields = validFields()
    delete fields.eventId

    const res = await POST(request(fields))

    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_id: null }))
  })

  it('uploads the image before inserting, under the row id', async () => {
    const { insert, upload } = mockClient()

    const res = await POST(request(validFields(), png()))
    const { id } = await res.json()

    expect(res.status).toBe(201)
    const path = `${TENANT_ID}/${USER_ID}/${id}/image.png`
    expect(upload).toHaveBeenCalledWith(path, expect.any(File), expect.anything())
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id, image_path: path }))
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0])
  })

  it('inserts nothing when the upload fails', async () => {
    const { insert } = mockClient({ uploadError: { message: 'boom' } })

    const res = await POST(request(validFields(), png()))

    expect(res.status).toBe(500)
    expect(insert).not.toHaveBeenCalled()
  })

  it('removes the uploaded image again when the insert fails', async () => {
    const { remove, upload } = mockClient({ insertError: { message: 'boom' } })

    const res = await POST(request(validFields(), png()))

    expect(res.status).toBe(500)
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]])
  })

  it('answers 403 when the insert policy refuses the row', async () => {
    mockClient({ insertError: { code: '42501', message: 'rls' } })

    const res = await POST(request(validFields()))

    expect(res.status).toBe(403)
  })
})
