import { describe, it, expect } from 'vitest'
import { createTenant, createUserWithRole, signInAsClient, cleanupTenant } from './helpers'

describe('local test OTP login', () => {
  it('signs in a freshly created user with the fixed test OTP', async () => {
    const tenant = await createTenant('Smoke Test Tenant')
    const { userId, phone } = await createUserWithRole(tenant.id, 'tenant_admin')

    const client = await signInAsClient(phone, '000000')
    const { data: sessionData } = await client.auth.getSession()

    expect(sessionData.session).not.toBeNull()
    expect(sessionData.session?.user.id).toBe(userId)

    await cleanupTenant(tenant.id)
  })
})
