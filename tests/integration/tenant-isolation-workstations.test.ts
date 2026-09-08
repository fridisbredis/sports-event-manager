import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// workstations has a tenant_id column and follows the canonical 0004
// pattern directly. workstation_operating_windows and workstation_todos
// have no tenant_id column at all — isolation is enforced only through an
// EXISTS join back to workstations.tenant_id (see migration 0004's
// tenant_admin_manage_workstation_op_windows / _todos policies). That
// indirection is exactly the kind of thing a future migration could break
// without anyone noticing at table-scan time, so it's covered here
// end-to-end rather than assumed safe from reading the SQL.
describe('SEC-01: tenant isolation on workstations and children', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventB: { id: string }
  let workstationB: { id: string }
  let opWindowB: { id: string }
  let todoB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Workstations')
    tenantB = await createTenant('Tenant B Workstations')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const admin = serviceClient()

    const { data: eventData, error: eventError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantB.id,
        name: 'Tenant B Event',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select()
      .single()
    if (eventError) throw eventError
    eventB = eventData

    const { data: wsData, error: wsError } = await admin
      .from('workstations')
      .insert({
        tenant_id: tenantB.id,
        event_id: eventB.id,
        name: 'Tenant B Workstation',
        capacity_ceiling: 3,
      })
      .select()
      .single()
    if (wsError) throw wsError
    workstationB = wsData

    const { data: opWindowData, error: opWindowError } = await admin
      .from('workstation_operating_windows')
      .insert({
        workstation_id: workstationB.id,
        window_start: '2026-06-01T06:00:00Z',
        window_end: '2026-06-01T18:00:00Z',
      })
      .select()
      .single()
    if (opWindowError) throw opWindowError
    opWindowB = opWindowData

    const { data: todoData, error: todoError } = await admin
      .from('workstation_todos')
      .insert({
        workstation_id: workstationB.id,
        instruction_text: 'Check equipment',
      })
      .select()
      .single()
    if (todoError) throw todoError
    todoB = todoData
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('cannot read tenant B workstations', async () => {
    const { data, error } = await clientAdminA
      .from('workstations')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot read tenant B workstation_operating_windows via the workstation join', async () => {
    const { data, error } = await clientAdminA
      .from('workstation_operating_windows')
      .select('*')
      .eq('workstation_id', workstationB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot read tenant B workstation_todos via the workstation join', async () => {
    const { data, error } = await clientAdminA
      .from('workstation_todos')
      .select('*')
      .eq('workstation_id', workstationB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot update a tenant B operating window', async () => {
    const { data, error } = await clientAdminA
      .from('workstation_operating_windows')
      .update({ window_start: '2026-06-01T05:00:00Z' })
      .eq('id', opWindowB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: unchanged } = await admin
      .from('workstation_operating_windows')
      .select('window_start')
      .eq('id', opWindowB.id)
      .single()
    expect(unchanged?.window_start).toBe('2026-06-01T06:00:00+00:00')
  })

  it('cannot update a tenant B todo', async () => {
    const { data, error } = await clientAdminA
      .from('workstation_todos')
      .update({ instruction_text: 'Hijacked' })
      .eq('id', todoB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: unchanged } = await admin
      .from('workstation_todos')
      .select('instruction_text')
      .eq('id', todoB.id)
      .single()
    expect(unchanged?.instruction_text).toBe('Check equipment')
  })

  it('cannot delete a tenant B workstation', async () => {
    const { data, error } = await clientAdminA
      .from('workstations')
      .delete()
      .eq('id', workstationB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('workstations')
      .select('id')
      .eq('id', workstationB.id)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it('cannot create an operating window under a tenant B workstation', async () => {
    const { error } = await clientAdminA.from('workstation_operating_windows').insert({
      workstation_id: workstationB.id,
      window_start: '2026-06-02T06:00:00Z',
      window_end: '2026-06-02T18:00:00Z',
    })
    expect(error).not.toBeNull()
  })

  it('can read and manage its own tenant workstations and children', async () => {
    const admin = serviceClient()
    const { data: eventA, error: eventAError } = await admin
      .from('events')
      .insert({
        tenant_id: tenantA.id,
        name: 'Tenant A Event',
        event_type: 'race',
        start_date: '2026-06-01',
        end_date: '2026-06-01',
      })
      .select()
      .single()
    if (eventAError) throw eventAError

    const { data: createdWs, error: wsInsertError } = await clientAdminA
      .from('workstations')
      .insert({
        tenant_id: tenantA.id,
        event_id: eventA.id,
        name: 'Tenant A Workstation',
        capacity_ceiling: 2,
      })
      .select()
      .single()
    expect(wsInsertError).toBeNull()
    expect(createdWs?.tenant_id).toBe(tenantA.id)

    const { data: createdWindow, error: windowInsertError } = await clientAdminA
      .from('workstation_operating_windows')
      .insert({
        workstation_id: createdWs!.id,
        window_start: '2026-06-01T06:00:00Z',
        window_end: '2026-06-01T18:00:00Z',
      })
      .select()
      .single()
    expect(windowInsertError).toBeNull()
    expect(createdWindow?.workstation_id).toBe(createdWs!.id)

    const { data: readWs, error: readWsError } = await clientAdminA
      .from('workstations')
      .select('*')
      .eq('tenant_id', tenantA.id)
    expect(readWsError).toBeNull()
    expect(readWs).toHaveLength(1)
  })
})
