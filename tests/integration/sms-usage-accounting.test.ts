import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'
import { recordSmsUsage } from '@/lib/sms/usage'
import { totalUsage } from '@/lib/sms/cost'

/**
 * sms_usage: the write path and its access posture (N11).
 *
 * The unit tests cover the arithmetic. These cover the things only a real
 * database can answer: that the insert shape matches the table, that the
 * CHECK constraints accept what the send routes actually write, and that a
 * signed-in tenant admin cannot read another tenant's spend — or their own.
 */
describe('sms_usage accounting', () => {
  let tenant: { id: string }
  let otherTenant: { id: string }
  let adminClient: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('SMS Usage Tenant')
    otherTenant = await createTenant('SMS Usage Other Tenant')

    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    adminClient = await signInAsClient(admin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
    await cleanupTenant(otherTenant.id)
  })

  it('records a sent message with the segment count Twilio reported', async () => {
    const service = serviceClient()

    await recordSmsUsage({
      service,
      tenantId: tenant.id,
      kind: 'announcement',
      message: { sid: 'SM_test_1', numSegments: '2', price: null, priceUnit: null },
      status: 'sent',
      op: 'test',
    })

    const { data } = await service
      .from('sms_usage')
      .select('kind, status, segments, message_sid, price')
      .eq('tenant_id', tenant.id)
      .eq('message_sid', 'SM_test_1')
      .single()

    expect(data).toMatchObject({
      kind: 'announcement',
      status: 'sent',
      segments: 2,
      message_sid: 'SM_test_1',
    })
    // price is null on nearly every create() response; nothing derives SEK
    // from it, so a null must be stored rather than coerced to zero.
    expect(data?.price).toBeNull()
  })

  it('records a failed send with no Twilio response at all', async () => {
    const service = serviceClient()

    // The send threw: there is no message object, no sid, no segment count.
    // The row still has to be insertable — this is the path the catch blocks
    // in all four send routes take.
    await recordSmsUsage({
      service,
      tenantId: tenant.id,
      kind: 'invite',
      message: null,
      status: 'failed',
      op: 'test',
    })

    const { data } = await service
      .from('sms_usage')
      .select('kind, status, segments, message_sid')
      .eq('tenant_id', tenant.id)
      .eq('kind', 'invite')
      .is('message_sid', null)
      .single()

    expect(data).toMatchObject({ kind: 'invite', status: 'failed', segments: 1 })
  })

  it('accepts every kind the send routes write', async () => {
    const service = serviceClient()

    // A CHECK constraint that disagreed with the call sites would only show up
    // in production, on the one send path nobody exercised by hand.
    for (const kind of ['invite', 'invite_resend', 'announcement', 'gdpr_warning'] as const) {
      await recordSmsUsage({
        service,
        tenantId: otherTenant.id,
        kind,
        message: { sid: `SM_kind_${kind}`, numSegments: '1' },
        status: 'sent',
        op: 'test',
      })
    }

    const { data } = await service.from('sms_usage').select('kind').eq('tenant_id', otherTenant.id)

    expect(new Set((data ?? []).map((r) => r.kind))).toEqual(
      new Set(['invite', 'invite_resend', 'announcement', 'gdpr_warning'])
    )
  })

  it("totals a tenant's usage without counting the failed rows", async () => {
    const service = serviceClient()

    const { data } = await service
      .from('sms_usage')
      .select('segments, status')
      .eq('tenant_id', tenant.id)

    const totals = totalUsage(data ?? [])

    // One sent 2-segment message and one failed one, from the tests above.
    expect(totals.sent).toBe(1)
    expect(totals.failed).toBe(1)
    expect(totals.segments).toBe(2)
  })

  it('is invisible to a signed-in tenant admin, including their own rows', async () => {
    // Deny-all plus RLS, same posture as sms_queue (0030). Spend is system
    // admin data: a tenant admin has no screen for it and no grant to read it,
    // so PostgREST must return nothing rather than their own tenant's rows.
    const { data, error } = await adminClient.from('sms_usage').select('id').limit(1)

    expect(data ?? []).toHaveLength(0)
    // Either an explicit permission error or an empty result is acceptable;
    // what must never happen is rows coming back.
    if (error) expect(error.code).toBeDefined()
  })

  it("removes a tenant's usage rows when the tenant is deleted", async () => {
    // on delete cascade. A tenant row that could not be deleted because its
    // usage history referenced it would block the system admin's delete path.
    const service = serviceClient()
    const temp = await createTenant('SMS Usage Cascade Tenant')

    await recordSmsUsage({
      service,
      tenantId: temp.id,
      kind: 'announcement',
      message: { sid: 'SM_cascade', numSegments: '1' },
      status: 'sent',
      op: 'test',
    })

    await cleanupTenant(temp.id)

    const { data } = await service.from('sms_usage').select('id').eq('tenant_id', temp.id)

    expect(data ?? []).toHaveLength(0)
  })
})
