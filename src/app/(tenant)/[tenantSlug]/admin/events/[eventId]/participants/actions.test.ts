import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  importParticipants,
  addParticipant,
  setParticipantHidden,
  removeParticipant,
} from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { fetchParticipants } from '@/lib/race-results/client'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
}))

// N23: resolveRequestEventId is tested on its own; here the event resolves.
vi.mock('@/lib/events/request-event', () => ({
  resolveRequestEventId: vi.fn(async () => 'event-1'),
}))

vi.mock('@/lib/race-results/client', () => ({
  fetchParticipants: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Translation helpers return the key, so assertions can name the key
// rather than its English rendering.
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))

vi.mock('@/lib/actions/db-error-message', () => ({
  translateDbError: vi.fn(
    async (_log: string, _err: unknown, fallback?: string) => fallback ?? 'dbError'
  ),
}))

vi.mock('@/lib/db/query-error', () => ({
  logQueryError: vi.fn(),
}))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const STAGE_ID = '22222222-2222-2222-2222-222222222222'

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'insert', 'update', 'delete', 'is', 'not', 'order']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

/**
 * A Supabase stub whose `from()` answers per table, so a test can set the
 * tenant's tier and the stage rows independently.
 */
function supabaseStub({
  tier = 'professional',
  stages = [{ id: STAGE_ID, name: 'Stage A', results_url: 'https://my.raceresult.com/361004/' }],
  rpcResult = { data: { inserted: 1, updated: 0, withdrawn: 0, revived: 0 }, error: null },
  insertResult = { data: null, error: null },
}: {
  tier?: string
  stages?: unknown[]
  rpcResult?: unknown
  insertResult?: unknown
} = {}) {
  const rpc = vi.fn(() => Promise.resolve(rpcResult))
  const participantsBuilder = chain(insertResult)
  const from = vi.fn((table: string) => {
    if (table === 'tenants') return chain({ data: { tier }, error: null })
    if (table === 'event_stages') return chain({ data: stages, error: null })
    return participantsBuilder
  })
  return {
    client: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
      from,
      rpc,
    },
    rpc,
    from,
    participantsBuilder,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
  vi.mocked(fetchParticipants).mockResolvedValue({
    ok: true,
    eventName: 'Viadal',
    skipped: 0,
    participants: [
      {
        externalId: '16',
        bib: '1',
        name: 'Höskuldur',
        nation: 'IS',
        gender: 'M',
        category: 'M75',
        club: 'Nátt',
        extra: {},
      },
    ],
  })
})

describe('importParticipants', () => {
  it('refuses a tenant whose tier does not include participants', async () => {
    // THE POINT OF THIS TEST. N21 mutates, so hiding the page and the nav
    // link is not access control: a Standard tenant's admin can post
    // straight at this action. The gate has to be here too.
    const stub = supabaseStub({ tier: 'standard' })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID],
    })

    expect(result.error).toBe('actionErrors.participantsNotInTier')
    expect(stub.rpc).not.toHaveBeenCalled()
    expect(fetchParticipants).not.toHaveBeenCalled()
  })

  it('allows premium', async () => {
    const stub = supabaseStub({ tier: 'premium' })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID],
    })

    expect(result.error).toBeUndefined()
    expect(stub.rpc).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller without admin access to the tenant', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID],
    })

    expect(result.error).toBe('actionErrors.notAuthorized')
    expect(stub.rpc).not.toHaveBeenCalled()
  })

  it('reads the results link from the database, never from the caller', async () => {
    // The import's source must not be caller-controlled: otherwise an
    // admin could point it at an arbitrary URL. The action takes stage
    // IDs and looks the links up itself, scoped by tenant.
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    await importParticipants({ tenantSlug: 't', tenantId: TENANT_ID, stageIds: [STAGE_ID] })

    expect(stub.from).toHaveBeenCalledWith('event_stages')
    expect(fetchParticipants).toHaveBeenCalledWith('361004')
  })

  it('reports a stage with no Race Results link without failing the run', async () => {
    const stub = supabaseStub({
      stages: [
        { id: STAGE_ID, name: 'No link', results_url: null },
        {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'Has link',
          results_url: 'https://my.raceresult.com/361004/',
        },
      ],
    })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID, '33333333-3333-3333-3333-333333333333'],
    })

    expect(result.outcomes).toHaveLength(2)
    expect(result.outcomes?.[0]).toMatchObject({
      ok: false,
      error: 'actionErrors.participantsNoResultsLink',
    })
    // The second stage still imported — one bad link does not stop the run.
    expect(result.outcomes?.[1].ok).toBe(true)
  })

  it('keeps earlier stages when a later fetch fails', async () => {
    // Each stage is a separate request to an undocumented API. If stage 2
    // fails, stage 1 must stay imported rather than being discarded with
    // it — which is why the RPC's transaction boundary is the stage.
    vi.mocked(fetchParticipants)
      .mockResolvedValueOnce({
        ok: true,
        eventName: 'A',
        skipped: 0,
        participants: [],
      })
      .mockResolvedValueOnce({ ok: false, kind: 'network', message: 'ECONNREFUSED' })

    const stub = supabaseStub({
      stages: [
        { id: STAGE_ID, name: 'A', results_url: 'https://my.raceresult.com/1/' },
        {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'B',
          results_url: 'https://my.raceresult.com/2/',
        },
      ],
    })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID, '33333333-3333-3333-3333-333333333333'],
    })

    expect(result.outcomes?.[0].ok).toBe(true)
    expect(result.outcomes?.[1]).toMatchObject({
      ok: false,
      error: 'actionErrors.participantsFetch_network',
    })
    // Stage A's write happened and was not rolled back by B's failure.
    expect(stub.rpc).toHaveBeenCalledTimes(1)
  })

  it('surfaces rows the API returned without a usable ID', async () => {
    // F-REL-10: a short list that looks plausible is the failure to avoid.
    vi.mocked(fetchParticipants).mockResolvedValue({
      ok: true,
      eventName: 'Viadal',
      skipped: 3,
      participants: [],
    })
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: [STAGE_ID],
    })

    expect(result.outcomes?.[0].skipped).toBe(3)
  })

  it('rejects an empty stage selection before touching the database', async () => {
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({ tenantSlug: 't', tenantId: TENANT_ID, stageIds: [] })

    expect(result.error).toBe('actionErrors.noStagesSelected')
    expect(fetchParticipants).not.toHaveBeenCalled()
  })

  it('drops stage ids that are not uuids', async () => {
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await importParticipants({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      stageIds: ['not-a-uuid'],
    })

    expect(result.error).toBe('actionErrors.noStagesSelected')
  })
})

describe('addParticipant', () => {
  it('refuses a tenant whose tier does not include participants', async () => {
    const stub = supabaseStub({ tier: 'standard' })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await addParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      name: 'Anna',
    })

    expect(result.error).toBe('actionErrors.participantsNotInTier')
    expect(stub.participantsBuilder.insert).not.toHaveBeenCalled()
  })

  it('inserts a manual row without an external id', async () => {
    // source stays at its 'manual' default and external_id stays NULL —
    // together that is what keeps an import from adopting or withdrawing
    // the row, and the DB constraint makes the pairing impossible to get
    // wrong.
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await addParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      name: 'Anna Svensson',
      bib: '42',
    })

    expect(result.error).toBeUndefined()
    expect(stub.participantsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_ID, name: 'Anna Svensson', bib: '42' })
    )
    const insertMock = stub.participantsBuilder.insert as ReturnType<typeof vi.fn>
    const written = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(written).not.toHaveProperty('external_id')
    expect(written).not.toHaveProperty('source')
  })

  it('stores blank optional fields as null rather than empty strings', async () => {
    // An empty string would read as a known-blank value; for phone it
    // would also be a false answer to the lookups that key on it.
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    await addParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      name: 'Anna',
      bib: '',
      club: '',
      phone: '',
    })

    expect(stub.participantsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ bib: null, club: null, phone: null })
    )
  })

  it('uppercases the nation code', async () => {
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    await addParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      name: 'Anna',
      nation: 'se',
    })

    expect(stub.participantsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ nation: 'SE' })
    )
  })

  it('rejects a blank name', async () => {
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await addParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      name: '   ',
    })

    expect(result.error).toBe('actionErrors.invalidRequest')
    expect(stub.participantsBuilder.insert).not.toHaveBeenCalled()
  })
})

const PARTICIPANT_ID = '33333333-3333-3333-3333-333333333333'

describe('setParticipantHidden', () => {
  it('sets hidden_at, never withdrawn_at', async () => {
    // withdrawn_at belongs to the import, which clears it for everyone in
    // the Race Results response — a hide written there would not survive
    // the next import (migration 20261030091721).
    const stub = supabaseStub({ insertResult: { data: [{ id: PARTICIPANT_ID }], error: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await setParticipantHidden({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
      hidden: true,
    })

    expect(result.error).toBeUndefined()
    const updateMock = stub.participantsBuilder.update as ReturnType<typeof vi.fn>
    const written = updateMock.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(written)).toEqual(['hidden_at'])
    expect(typeof written.hidden_at).toBe('string')
    expect(stub.participantsBuilder.eq).toHaveBeenCalledWith('event_id', 'event-1')
  })

  it('clears hidden_at to show the participant again', async () => {
    const stub = supabaseStub({ insertResult: { data: [{ id: PARTICIPANT_ID }], error: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    await setParticipantHidden({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
      hidden: false,
    })

    expect(stub.participantsBuilder.update).toHaveBeenCalledWith({ hidden_at: null })
  })

  it('reports a participant that matched no row instead of claiming success', async () => {
    const stub = supabaseStub({ insertResult: { data: [], error: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await setParticipantHidden({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
      hidden: true,
    })

    expect(result.error).toBe('actionErrors.participantNotFound')
  })

  it('refuses a tenant whose tier does not include participants', async () => {
    const stub = supabaseStub({ tier: 'standard' })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await setParticipantHidden({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
      hidden: true,
    })

    expect(result.error).toBe('actionErrors.participantsNotInTier')
    expect(stub.participantsBuilder.update).not.toHaveBeenCalled()
  })

  it('rejects a participant id that is not a uuid', async () => {
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await setParticipantHidden({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: 'not-a-uuid',
      hidden: true,
    })

    expect(result.error).toBe('actionErrors.invalidRequest')
    expect(stub.participantsBuilder.update).not.toHaveBeenCalled()
  })
})

describe('removeParticipant', () => {
  it('deletes only a manually added row in this event', async () => {
    const stub = supabaseStub({ insertResult: { data: [{ id: PARTICIPANT_ID }], error: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await removeParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
    })

    expect(result.error).toBeUndefined()
    expect(stub.participantsBuilder.delete).toHaveBeenCalled()
    expect(stub.participantsBuilder.eq).toHaveBeenCalledWith('source', 'manual')
    expect(stub.participantsBuilder.eq).toHaveBeenCalledWith('event_id', 'event-1')
    expect(stub.participantsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('reports an imported or unknown participant as not found', async () => {
    // The source filter makes an imported row match nothing; the caller
    // must hear that rather than see a success that removed no one.
    const stub = supabaseStub({ insertResult: { data: [], error: null } })
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await removeParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
    })

    expect(result.error).toBe('actionErrors.participantNotFound')
  })

  it('refuses a caller without admin access to the tenant', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const stub = supabaseStub()
    vi.mocked(createSupabaseServerClient).mockResolvedValue(stub.client as never)

    const result = await removeParticipant({
      tenantSlug: 't',
      tenantId: TENANT_ID,
      eventId: 'event-1',
      participantId: PARTICIPANT_ID,
    })

    expect(result.error).toBe('actionErrors.notAuthorized')
    expect(stub.participantsBuilder.delete).not.toHaveBeenCalled()
  })
})
