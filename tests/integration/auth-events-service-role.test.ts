import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { serviceClient } from './helpers'

/**
 * logAuthEvent() writes auth_events through the service-role client (ADR-0001
 * category 5): a failed OTP verify has no session to satisfy an RLS policy
 * with. So the service role's table grant is the only thing between a login
 * and its audit row.
 *
 * Hosted Supabase grants service_role automatically; a local `db reset` does
 * not, and migration 0038 never grants it. B17: the local stack silently
 * dropped every auth event, because logAuthEvent() is fail-safe and only logs.
 * This pins the grant supabase/seed.sql now supplies.
 */
describe('auth_events service-role write (B17)', () => {
  // Not a real phone hash — a marker this test alone writes and removes.
  const phoneHash = `b17-test-${randomUUID()}`

  afterAll(async () => {
    await serviceClient().from('auth_events').delete().eq('phone_hash', phoneHash)
  })

  it('lets the service role insert and read back an auth event', async () => {
    const { error: insertError } = await serviceClient()
      .from('auth_events')
      .insert({ phone_hash: phoneHash, event: 'otp_send_succeeded' })

    expect(insertError).toBeNull()

    const { data, error } = await serviceClient()
      .from('auth_events')
      .select('event')
      .eq('phone_hash', phoneHash)

    expect(error).toBeNull()
    expect(data).toEqual([{ event: 'otp_send_succeeded' }])
  })
})
