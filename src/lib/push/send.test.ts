import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import webpush, { WebPushError } from 'web-push'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { sendAnnouncementPush } from './send'

vi.mock('web-push', async (importOriginal) => {
  // web-push is CommonJS: its types describe only the named exports, but the
  // module also arrives as a default export, which is what send.ts calls.
  const actual = await importOriginal<typeof import('web-push') & { default: object }>()
  return {
    ...actual,
    default: { ...actual.default, sendNotification: vi.fn() },
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const TENANT_ID = 'tenant-1'
const EVENT_ID = 'event-1'
const DEVICE_A = { endpoint: 'https://web.push.apple.com/device-a', p256dh: 'pa', auth: 'aa' }
const DEVICE_B = { endpoint: 'https://fcm.googleapis.com/device-b', p256dh: 'pb', auth: 'ab' }

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'not', 'in', 'delete']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

// One builder per table, so a test can both feed results and inspect the
// filters each query applied.
function mockDb({
  officials = { data: [{ user_id: 'user-1' }, { user_id: 'user-2' }], error: null } as unknown,
  devices = { data: [DEVICE_A, DEVICE_B], error: null } as unknown,
  tenant = { data: { name: 'Viadal', slug: 'viadal' }, error: null } as unknown,
  deleteResult = { error: null } as unknown,
} = {}) {
  const builders = {
    officials: chain(officials),
    tenants: chain(tenant),
    devices: chain(devices),
    deletes: chain(deleteResult),
  }
  let pushTableCalls = 0
  const from = vi.fn((table: string) => {
    if (table === 'officials') return builders.officials
    if (table === 'tenants') return builders.tenants
    // push_subscriptions: first the device read, then (if any) the cleanup.
    pushTableCalls += 1
    return pushTableCalls === 1 ? builders.devices : builders.deletes
  })
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never)
  return { from, builders }
}

function sentPayload(callIndex = 0) {
  return JSON.parse(vi.mocked(webpush.sendNotification).mock.calls[callIndex][1] as string)
}

function pushError(statusCode: number) {
  return new WebPushError('push service said no', statusCode, {}, '', DEVICE_A.endpoint)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public-key')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example')
  vi.mocked(webpush.sendNotification).mockResolvedValue({} as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sendAnnouncementPush', () => {
  it('sends the announcement to every device of the event officials', async () => {
    mockDb()

    const outcome = await sendAnnouncementPush({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      body: 'Start moved to 10:00',
    })

    expect(outcome).toEqual({ sent: 2, failed: 0, removed: 0 })
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: DEVICE_A.endpoint, keys: { p256dh: 'pa', auth: 'aa' } },
      expect.any(String),
      expect.objectContaining({
        vapidDetails: {
          subject: 'https://app.example',
          publicKey: 'public-key',
          privateKey: 'private-key',
        },
      })
    )
    expect(sentPayload()).toEqual({
      title: 'Viadal',
      body: 'Start moved to 10:00',
      url: '/viadal/events/event-1/announcements',
    })
  })

  // N23: an official of another event in the same tenant must not be pushed
  // this event's announcement, and a removed official must not be pushed at all.
  it('resolves recipients through the event membership and confirmed status', async () => {
    const { builders } = mockDb()

    await sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'Hej' })

    expect(builders.officials.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(builders.officials.eq).toHaveBeenCalledWith('official_events.event_id', EVENT_ID)
    expect(builders.officials.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
    expect(builders.devices.in).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
  })

  // sms_opt_out is an SMS choice. Push is opted into on the device, so an
  // official who turned SMS off but push on must still get the push.
  it('does not filter on sms_opt_out', async () => {
    const { builders } = mockDb()

    await sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'Hej' })

    const filtered = vi.mocked(builders.officials.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(filtered.map(([column]) => column)).not.toContain('sms_opt_out')
  })

  it('cuts a long announcement to a preview that fits a push payload', async () => {
    mockDb({ devices: { data: [DEVICE_A], error: null } })

    await sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'å'.repeat(1600) })

    const { body } = sentPayload()
    expect(body.length).toBe(300)
    expect(body.endsWith('…')).toBe(true)
  })

  // 404/410 means the push service has forgotten the subscription for good.
  it('deletes subscriptions the push service reports as gone', async () => {
    const { builders } = mockDb()
    vi.mocked(webpush.sendNotification)
      .mockRejectedValueOnce(pushError(410))
      .mockResolvedValueOnce({} as never)

    const outcome = await sendAnnouncementPush({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      body: 'Hej',
    })

    expect(outcome).toEqual({ sent: 1, failed: 0, removed: 1 })
    expect(builders.deletes.delete).toHaveBeenCalled()
    expect(builders.deletes.in).toHaveBeenCalledWith('endpoint', [DEVICE_A.endpoint])
  })

  // Any other failure may be temporary, so the row stays. The log names the
  // push service, never the endpoint, which identifies a device.
  it('keeps the subscription and logs only the push host on other failures', async () => {
    const { from } = mockDb({ devices: { data: [DEVICE_A], error: null } })
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(pushError(500))

    const outcome = await sendAnnouncementPush({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      body: 'Hej',
    })

    expect(outcome).toEqual({ sent: 0, failed: 1, removed: 0 })
    expect(from).toHaveBeenCalledTimes(3)
    const context = vi.mocked(logger.error).mock.calls[0][2]
    expect(context).toMatchObject({ pushHost: 'web.push.apple.com', statusCode: 500 })
    expect(JSON.stringify(context)).not.toContain('device-a')
  })

  it('sends nothing and touches no data when VAPID is not configured', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const { from } = mockDb()

    const outcome = await sendAnnouncementPush({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      body: 'Hej',
    })

    expect(outcome).toEqual({ sent: 0, failed: 0, removed: 0 })
    expect(from).not.toHaveBeenCalled()
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  // Apple rejects a localhost subject, so a local run must not try.
  it('sends nothing when the app URL is not https', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    mockDb()

    await sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'Hej' })

    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('does not look for devices when the event has no signed-in officials', async () => {
    const { from } = mockDb({ officials: { data: [], error: null } })

    await sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'Hej' })

    expect(from).toHaveBeenCalledTimes(1)
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('logs and sends nothing when the recipient query fails', async () => {
    mockDb({ officials: { data: null, error: { code: '57014', message: 'timeout' } } })

    const outcome = await sendAnnouncementPush({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      body: 'Hej',
    })

    expect(outcome).toEqual({ sent: 0, failed: 0, removed: 0 })
    expect(logger.error).toHaveBeenCalled()
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  // It runs inside after(); anything it throws would surface as an unhandled
  // error with nobody to report it to.
  it('never throws, even when the database client itself does', async () => {
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => {
      throw new Error('no service key')
    })

    await expect(
      sendAnnouncementPush({ tenantId: TENANT_ID, eventId: EVENT_ID, body: 'Hej' })
    ).resolves.toEqual({ sent: 0, failed: 0, removed: 0 })
    expect(logger.error).toHaveBeenCalled()
  })
})
