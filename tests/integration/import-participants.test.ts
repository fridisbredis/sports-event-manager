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

// N21 / PART-01: import_participants (migration 20261026094609).
//
// Against real Postgres rather than a mock, for two reasons the migrations
// reference spells out. First, the function returns jsonb, and
// `supabase gen types` cannot see inside that — the generated signature is
// `Json`, so nothing but an integration test can assert the response keys
// the app destructures (F-REL-16). Second, the behaviour under test IS the
// SQL: the upsert's conflict target, the withdrawal scoping, and the RLS
// the function runs under. A mocked client would assert only that the app
// calls something.

interface ImportResult {
  inserted: number
  updated: number
  linked: number
  withdrawn: number
  revived: number
}

type ImportRow = Record<string, string | Record<string, string>>

function row(
  externalId: string,
  fields: Record<string, string | Record<string, string>> = {}
): ImportRow {
  return { external_id: externalId, ...fields }
}

describe('import_participants (N21)', () => {
  let tenantId: string
  let eventId: string
  let otherTenantId: string
  let stageAId: string
  let stageBId: string
  let adminClient: SupabaseClient<Database>

  async function importInto(
    stageId: string,
    rows: ImportRow[],
    client: SupabaseClient<Database> = adminClient
  ) {
    const { data, error } = await client.rpc('import_participants', {
      p_tenant_id: tenantId,
      p_stage_id: stageId,
      p_rows: rows as unknown as Json,
    })
    return { data: data as unknown as ImportResult | null, error }
  }

  async function participants() {
    const { data } = await serviceClient()
      .from('participants')
      .select('external_id, name, phone, source, sms_opt_out, withdrawn_at, extra, nation')
      .eq('tenant_id', tenantId)
    return data ?? []
  }

  beforeAll(async () => {
    const tenant = await createTenant('N21 Import Tenant')
    tenantId = tenant.id
    const other = await createTenant('N21 Other Tenant')
    otherTenantId = other.id

    const admin = serviceClient()
    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({ tenant_id: tenantId, name: 'N21 Event', event_type: 'race' })
      .select('id')
      .single()
    if (eventError) throw eventError
    eventId = event.id

    const { data: stages, error: stageError } = await admin
      .from('event_stages')
      .insert([
        { event_id: event.id, tenant_id: tenantId, name: 'Stage A', stage_type: 'race' },
        { event_id: event.id, tenant_id: tenantId, name: 'Stage B', stage_type: 'race' },
      ])
      .select('id, name')
    if (stageError) throw stageError

    stageAId = stages.find((s) => s.name === 'Stage A')!.id
    stageBId = stages.find((s) => s.name === 'Stage B')!.id

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  it('returns every key the app reads off the response', async () => {
    // The return-shape contract. A later `replace` migration that drops a
    // key here would otherwise go undetected until an admin saw a blank
    // import summary — the exact failure mode of migration 0045.
    const { data, error } = await importInto(stageAId, [row('16', { name: 'Höskuldur' })])

    expect(error).toBeNull()
    expect(data).toEqual({
      inserted: expect.any(Number),
      updated: expect.any(Number),
      linked: expect.any(Number),
      withdrawn: expect.any(Number),
      revived: expect.any(Number),
    })
  })

  it('inserts new participants and links them to the stage', async () => {
    const { data } = await importInto(stageAId, [
      row('22', { name: 'PerOla', bib: '2', nation: 'SE' }),
      row('4', { name: 'Tommy', bib: '3' }),
    ])

    expect(data?.inserted).toBe(2)
    expect(data?.linked).toBe(2)

    const all = await participants()
    expect(all.map((p) => p.external_id)).toEqual(expect.arrayContaining(['22', '4']))
  })

  it('updates an existing participant rather than duplicating them', async () => {
    const { data } = await importInto(stageAId, [row('4', { name: 'Tommy Carlsson' })])

    expect(data?.inserted).toBe(0)
    expect(data?.updated).toBe(1)

    const all = await participants()
    const matching = all.filter((p) => p.external_id === '4')
    expect(matching).toHaveLength(1)
    expect(matching[0].name).toBe('Tommy Carlsson')
  })

  it('keeps one row with two stage links when a person runs both stages', async () => {
    // Peter's answer to the card's question 2, 2026-10-20: "one entry, two
    // stages". This is the assertion that the link table actually delivers
    // it — a stage_id column on the row could not.
    await importInto(stageBId, [row('16', { name: 'Höskuldur' })])

    const all = await participants()
    expect(all.filter((p) => p.external_id === '16')).toHaveLength(1)

    const { data: links } = await serviceClient()
      .from('participant_stages')
      .select('stage_id, participant_id, participants!inner(external_id)')
      .eq('tenant_id', tenantId)

    const linksFor16 = (links ?? []).filter(
      (l) => (l.participants as unknown as { external_id: string }).external_id === '16'
    )
    expect(linksFor16.map((l) => l.stage_id).sort()).toEqual([stageAId, stageBId].sort())
  })

  it('withdraws a participant struck from the list instead of deleting them', async () => {
    // The card's question 3, implemented per the plan's proposal: mark,
    // never delete. A deletion cannot be undone if the import ran against
    // the wrong race or a truncated response.
    //
    // '22' is re-imported first so this case does not depend on whether an
    // earlier test left it struck: an already-withdrawn row is deliberately
    // NOT re-counted by the RPC (its timestamp should say when the person
    // was first struck, not when the last import ran), so without this the
    // assertion would measure test ordering rather than behaviour.
    await importInto(stageAId, [
      row('16', { name: 'Höskuldur' }),
      row('4', { name: 'Tommy Carlsson' }),
      row('22', { name: 'PerOla Axelsson' }),
    ])

    const { data } = await importInto(stageAId, [
      row('16', { name: 'Höskuldur' }),
      row('4', { name: 'Tommy Carlsson' }),
      // '22' is absent from this response.
    ])

    expect(data?.withdrawn).toBe(1)

    const all = await participants()
    const struck = all.find((p) => p.external_id === '22')
    expect(struck).toBeDefined()
    expect(struck?.withdrawn_at).not.toBeNull()
  })

  it('revives a participant who comes back, and counts them', async () => {
    const { data } = await importInto(stageAId, [
      row('16', { name: 'Höskuldur' }),
      row('4', { name: 'Tommy Carlsson' }),
      row('22', { name: 'PerOla Axelsson' }),
    ])

    expect(data?.revived).toBe(1)

    const all = await participants()
    expect(all.find((p) => p.external_id === '22')?.withdrawn_at).toBeNull()
  })

  it('never touches a manually added participant', async () => {
    // The card's "Manual entries get a separate ID series": an import owns
    // only the rows it created. A manual row must survive an import that
    // does not mention it — it is not in any Race Results response by
    // definition, so a naive "withdraw everyone absent" would strike it.
    const admin = serviceClient()
    const { data: manualRow, error: manualError } = await admin
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: eventId, name: 'Manuell Person', source: 'manual' })
      .select('id')
      .single()
    expect(manualError).toBeNull()

    // LINK IT TO THE STAGE BEING IMPORTED. Without this link the row is
    // out of the withdrawal query's reach anyway (it only considers
    // participants linked to the stage), so the test would pass even if
    // the `source = 'race_results'` guard were deleted — it would be
    // asserting the wrong mechanism. An admin adding someone by hand to a
    // stage they then re-import is exactly the case that must survive.
    const { error: linkError } = await admin
      .from('participant_stages')
      .insert({ participant_id: manualRow!.id, stage_id: stageAId, tenant_id: tenantId })
    expect(linkError).toBeNull()

    await importInto(stageAId, [row('16', { name: 'Höskuldur' })])

    const all = await participants()
    const manual = all.find((p) => p.source === 'manual')
    expect(manual?.name).toBe('Manuell Person')
    expect(manual?.withdrawn_at).toBeNull()
  })

  it('preserves a phone number and an opt-out across a re-import', async () => {
    // Race Results has no phone numbers, so the import must never write
    // that column. If it did, a re-import would wipe a number someone had
    // since linked and silently re-enable SMS for someone who opted out.
    const admin = serviceClient()
    await admin
      .from('participants')
      .update({ phone: '+46709999999', sms_opt_out: true })
      .eq('tenant_id', tenantId)
      .eq('external_id', '16')

    await importInto(stageAId, [row('16', { name: 'Nytt Namn' })])

    const all = await participants()
    const person = all.find((p) => p.external_id === '16')
    expect(person?.name).toBe('Nytt Namn')
    expect(person?.phone).toBe('+46709999999')
    expect(person?.sms_opt_out).toBe(true)
  })

  it('stores unmapped Race Results fields in extra', async () => {
    await importInto(stageAId, [row('16', { name: 'Höskuldur', extra: { TEAM: 'Alpha' } })])

    const all = await participants()
    expect(all.find((p) => p.external_id === '16')?.extra).toEqual({ TEAM: 'Alpha' })
  })

  it('is idempotent when the same list is imported twice', async () => {
    const rows = [row('77', { name: 'Idempotent' })]
    await importInto(stageBId, rows)
    const { data: second } = await importInto(stageBId, rows)

    expect(second?.inserted).toBe(0)
    expect(second?.linked).toBe(0)

    const all = await participants()
    expect(all.filter((p) => p.external_id === '77')).toHaveLength(1)
  })

  it('rejects a stage belonging to another tenant', async () => {
    // RLS on participants cannot catch this: the row being written is
    // legitimately this tenant's. Only the function's own stage/tenant
    // check stops an import from attaching rows to someone else's stage.
    const admin = serviceClient()
    const { data: otherEvent } = await admin
      .from('events')
      .insert({ tenant_id: otherTenantId, name: 'Other', event_type: 'race' })
      .select('id')
      .single()
    const { data: otherStage } = await admin
      .from('event_stages')
      .insert({
        event_id: otherEvent!.id,
        tenant_id: otherTenantId,
        name: 'Other Stage',
        stage_type: 'race',
      })
      .select('id')
      .single()

    const { error } = await importInto(otherStage!.id, [row('1', { name: 'Nope' })])

    expect(error).not.toBeNull()
  })

  it('rejects p_rows that is not an array', async () => {
    const { error } = await adminClient.rpc('import_participants', {
      p_tenant_id: tenantId,
      p_stage_id: stageAId,
      p_rows: { external_id: '1' } as never,
    })

    expect(error).not.toBeNull()
  })

  // ------------------------------------------------------------------
  // participants.user_id integrity (migration 20261026104544).
  //
  // Participant login does not exist yet — Peter designs that flow. These
  // assert that the column it will hang off cannot be populated wrongly
  // before it does, which is cheap now (prod holds no participants) and a
  // data-cleanup exercise later.
  // ------------------------------------------------------------------

  it('refuses to link one auth user to two participants', async () => {
    // The split-identity case: two rows, one account, and a personal
    // schedule that shows half their races. Linking will be an automated
    // phone match against an imported list, where a person appearing twice
    // (two entries, a re-import, a corrected bib) is exactly what produces
    // it — so this must be impossible rather than merely unlikely.
    const admin = serviceClient()
    const { data: authUser } = await admin.auth.admin.createUser({
      phone: '+46709000111',
      phone_confirm: true,
    })
    const userId = authUser.user!.id

    const first = await admin
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: eventId, name: 'Linked A', user_id: userId })
    expect(first.error).toBeNull()

    const second = await admin
      .from('participants')
      .insert({ tenant_id: tenantId, event_id: eventId, name: 'Linked B', user_id: userId })
    expect(second.error).not.toBeNull()

    await admin.from('participants').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  })

  it('refuses a user_id with no matching auth user', async () => {
    const { error } = await serviceClient().from('participants').insert({
      tenant_id: tenantId,
      event_id: eventId,
      name: 'Ghost',
      user_id: '00000000-0000-0000-0000-0000000000ff',
    })

    expect(error).not.toBeNull()
  })

  it('unlinks rather than deletes when the auth user goes away', async () => {
    // ON DELETE SET NULL, matching officials. A participant row records
    // that someone entered the race; the bib and class stay true after the
    // account is gone, and the admin roster still needs the row.
    const admin = serviceClient()
    const { data: authUser } = await admin.auth.admin.createUser({
      phone: '+46709000222',
      phone_confirm: true,
    })
    const userId = authUser.user!.id

    const { data: inserted } = await admin
      .from('participants')
      .insert({
        tenant_id: tenantId,
        event_id: eventId,
        name: 'Survives',
        bib: '999',
        user_id: userId,
      })
      .select('id')
      .single()

    await admin.auth.admin.deleteUser(userId)

    const { data: after } = await admin
      .from('participants')
      .select('name, bib, user_id')
      .eq('id', inserted!.id)
      .single()

    expect(after).toMatchObject({ name: 'Survives', bib: '999', user_id: null })

    await admin.from('participants').delete().eq('id', inserted!.id)
  })

  it('allows many participants with no linked account', async () => {
    // The normal state: every imported participant has user_id NULL, so
    // the uniqueness must not treat NULLs as colliding.
    const { error } = await serviceClient()
      .from('participants')
      .insert([
        { tenant_id: tenantId, event_id: eventId, name: 'Unlinked A' },
        { tenant_id: tenantId, event_id: eventId, name: 'Unlinked B' },
      ])

    expect(error).toBeNull()
  })

  it('accepts an empty list without writing anything', async () => {
    const before = (await participants()).length
    const { data, error } = await importInto(stageBId, [])

    expect(error).toBeNull()
    expect(data?.inserted).toBe(0)
    expect((await participants()).length).toBe(before)
  })
})
