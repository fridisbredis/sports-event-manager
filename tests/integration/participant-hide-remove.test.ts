import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// N34 / PART-01: hiding a participant and removing a manually added one.
//
// Against real Postgres because the property that matters is a property of
// the SQL: that import_participants never writes hidden_at (migration
// 20261030091721), so a re-import cannot undo an admin's hide. A mocked
// client could only show that the app writes the right column; it cannot
// show the import leaves it alone. The writes run as a tenant admin through
// RLS, the same client the server actions use.

describe('participant hide and remove (N34)', () => {
  let tenantId: string
  let eventId: string
  let stageId: string
  let otherTenantId: string
  let adminClient: SupabaseClient<Database>
  let otherAdminClient: SupabaseClient<Database>

  async function importInto(externalIds: string[]) {
    const { error } = await adminClient.rpc('import_participants', {
      p_tenant_id: tenantId,
      p_stage_id: stageId,
      p_rows: externalIds.map((id) => ({
        external_id: id,
        name: `Runner ${id}`,
      })) as unknown as Json,
    })
    if (error) throw error
  }

  async function byExternalId(externalId: string) {
    const { data, error } = await serviceClient()
      .from('participants')
      .select('id, hidden_at, withdrawn_at')
      .eq('tenant_id', tenantId)
      .eq('external_id', externalId)
      .single()
    if (error) throw error
    return data
  }

  async function addManual(name: string) {
    const { data, error } = await adminClient
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: eventId, name })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  beforeAll(async () => {
    const tenant = await createTenant('N34 Hide Tenant')
    tenantId = tenant.id
    const other = await createTenant('N34 Other Tenant')
    otherTenantId = other.id

    const admin = serviceClient()
    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({ tenant_id: tenantId, name: 'N34 Event', event_type: 'race' })
      .select('id')
      .single()
    if (eventError) throw eventError
    eventId = event.id

    const { data: stage, error: stageError } = await admin
      .from('event_stages')
      .insert({ event_id: eventId, tenant_id: tenantId, name: 'Stage A', stage_type: 'race' })
      .select('id')
      .single()
    if (stageError) throw stageError
    stageId = stage.id

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
    const otherAdmin = await createUserWithRole(otherTenantId, 'tenant_admin')
    otherAdminClient = await signInAsClient(otherAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('keeps a hidden participant hidden across a re-import', async () => {
    // The card's design point. The import clears withdrawn_at for everyone
    // in the response; if the hide lived there, this re-import would undo it.
    await importInto(['1', '2'])
    const before = await byExternalId('1')

    const { error } = await adminClient
      .from('participants')
      .update({ hidden_at: new Date().toISOString() })
      .eq('id', before.id)
    expect(error).toBeNull()

    await importInto(['1', '2'])

    expect((await byExternalId('1')).hidden_at).not.toBeNull()
  })

  it('keeps the hide when the import withdraws and then revives the person', async () => {
    // The two states are independent: the import owns withdrawn_at, the
    // admin owns hidden_at, and neither cycle touches the other.
    await importInto(['2'])
    const struck = await byExternalId('1')
    expect(struck.withdrawn_at).not.toBeNull()
    expect(struck.hidden_at).not.toBeNull()

    await importInto(['1', '2'])
    const revived = await byExternalId('1')
    expect(revived.withdrawn_at).toBeNull()
    expect(revived.hidden_at).not.toBeNull()
  })

  it('lets a tenant admin delete a manual participant, taking its stage links along', async () => {
    const id = await addManual('Typo Person')
    const { error: linkError } = await serviceClient()
      .from('participant_stages')
      .insert({ participant_id: id, stage_id: stageId, tenant_id: tenantId })
    expect(linkError).toBeNull()

    const { data, error } = await adminClient
      .from('participants')
      .delete()
      .eq('id', id)
      .eq('source', 'manual')
      .select('id')

    expect(error).toBeNull()
    expect(data).toHaveLength(1)

    const { data: links } = await serviceClient()
      .from('participant_stages')
      .select('participant_id')
      .eq('participant_id', id)
    expect(links).toEqual([])
  })

  it("does not let another tenant's admin hide or delete the row", async () => {
    const id = await addManual('Protected Person')

    const { data: updated } = await otherAdminClient
      .from('participants')
      .update({ hidden_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
    expect(updated ?? []).toHaveLength(0)

    const { data: deleted } = await otherAdminClient
      .from('participants')
      .delete()
      .eq('id', id)
      .select('id')
    expect(deleted ?? []).toHaveLength(0)

    const { data: still } = await serviceClient()
      .from('participants')
      .select('id, hidden_at')
      .eq('id', id)
      .single()
    expect(still?.hidden_at).toBeNull()
  })
})
