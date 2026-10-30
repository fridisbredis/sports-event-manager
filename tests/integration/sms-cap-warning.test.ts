import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  deleteAuthUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'
import { sendSmsCapWarnings } from '@/lib/sms/cap-warning'
import { startOfMonthUtc } from '@/lib/sms/cost'

/**
 * The N32 90% warning against a real database.
 *
 * The unit tests cover the rules. These cover what only Postgres and
 * PostgREST can answer: that the `.or()` recipient filter really selects this
 * tenant's admins plus every system admin, that the (tenant_id, month) key
 * stops two concurrent runs from both sending, and that the table is closed
 * to signed-in users.
 *
 * Twilio is a fake: nothing is sent. Other tenants in the local database may
 * also be warned by these runs, so every assertion filters on this tenant's
 * name in the body.
 */
describe('SMS cap warning (N32)', () => {
  const TENANT_NAME = `CapWarn ${Date.now()}`
  const month = startOfMonthUtc().slice(0, 10)

  let tenant: { id: string }
  let tenantAdmin: { userId: string; phone: string }
  let official: { userId: string; phone: string }
  let systemAdmin: { userId: string; phone: string }
  let adminClient: Awaited<ReturnType<typeof signInAsClient>>

  const create = vi.fn(async () => ({ numSegments: '1' }))
  const client = { messages: { create } } as never

  /** The numbers this tenant's warning went to, without the leading '+'. */
  const recipientsForTenant = () =>
    (create.mock.calls as unknown as [{ body: string; to: string }][])
      .map(([args]) => args)
      .filter((args) => args.body.includes(TENANT_NAME))
      .map((args) => args.to.replace(/^\+/, ''))

  const digits = (phone: string) => phone.replace(/^\+/, '')

  beforeAll(async () => {
    // Standard: a 100 SEK cap.
    tenant = await createTenant(TENANT_NAME, 'standard')
    tenantAdmin = await createUserWithRole(tenant.id, 'tenant_admin')
    official = await createUserWithRole(tenant.id, 'official')
    systemAdmin = await createSystemAdmin()
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')

    // 90 segments at 1 SEK each (rate stubbed below) — exactly 90%.
    const { error } = await serviceClient()
      .from('sms_usage')
      .insert({ tenant_id: tenant.id, kind: 'announcement', status: 'sent', segments: 90 })
    if (error) throw error
  })

  afterAll(async () => {
    // Cascades to sms_usage and sms_cap_warnings.
    await cleanupTenant(tenant.id)
    await deleteAuthUser(systemAdmin.userId)
  })

  beforeEach(() => {
    create.mockClear()
    vi.stubEnv('SMS_COST_PER_SEGMENT', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('texts the tenant admin and the system admin, not the official, once', async () => {
    // Two runs at once, as two overlapping worker ticks would be. The primary
    // key lets exactly one of them claim the tenant.
    await Promise.all([
      sendSmsCapWarnings({ service: serviceClient(), client, fromNumber: '+15550001111' }),
      sendSmsCapWarnings({ service: serviceClient(), client, fromNumber: '+15550001111' }),
    ])

    const recipients = recipientsForTenant()
    expect(recipients).toContain(digits(tenantAdmin.phone))
    expect(recipients).toContain(digits(systemAdmin.phone))
    expect(recipients).not.toContain(digits(official.phone))
    // One SMS per person, despite two runs.
    expect(new Set(recipients).size).toBe(recipients.length)

    const { data: row } = await serviceClient()
      .from('sms_cap_warnings')
      .select('month, sent_count, failed_count, segments')
      .eq('tenant_id', tenant.id)
      .single()

    expect(row).toEqual({
      month,
      sent_count: recipients.length,
      failed_count: 0,
      segments: recipients.length,
    })
  })

  it('does not warn the same tenant again this month', async () => {
    await sendSmsCapWarnings({ service: serviceClient(), client, fromNumber: '+15550001111' })

    expect(recipientsForTenant()).toEqual([])
  })

  it('leaves the tenant SMS cost untouched', async () => {
    const { data } = await serviceClient()
      .from('sms_usage')
      .select('segments')
      .eq('tenant_id', tenant.id)

    expect(data).toEqual([{ segments: 90 }])
  })

  it('is not readable by a signed-in tenant admin', async () => {
    const { data } = await adminClient
      .from('sms_cap_warnings')
      .select('tenant_id')
      .eq('tenant_id', tenant.id)

    // Revoked grants surface as an error or as no rows; either way, nothing.
    expect(data ?? []).toEqual([])
  })
})
