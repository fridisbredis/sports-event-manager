import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// N72 (migration 20261127105240). Tasks are written only through save_task
// and set_task_done, and officials read only the tasks they are assigned to.
// All of that lives in Postgres (RLS, grants, SECURITY DEFINER checks, FKs),
// so only a real database can prove it.

type Client = SupabaseClient<Database>

const DEADLINE = '2026-12-01T10:00:00+00:00'

describe('tasks (N72)', () => {
  let tenantId: string
  let otherTenantId: string
  let eventId: string
  let otherEventId: string
  let stageId: string
  let otherEventStageId: string
  let adminClient: Client
  let otherTenantAdminClient: Client
  let assigneeClient: Client
  let colleagueClient: Client
  let outsiderClient: Client
  let assigneeOfficialId: string
  let colleagueOfficialId: string
  let outsiderOfficialId: string

  const admin = () => serviceClient()

  async function officialIdFor(userId: string) {
    const { data } = await admin()
      .from('officials')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .single()
    return data!.id
  }

  async function addToEvent(officialId: string, event: string) {
    const { error } = await admin()
      .from('official_events')
      .insert({ official_id: officialId, event_id: event, tenant_id: tenantId })
    if (error) throw error
  }

  function saveArgs(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      p_tenant_id: tenantId,
      p_event_id: eventId,
      p_task_id: null,
      p_stage_id: stageId,
      p_name: 'Order bibs',
      p_description: null,
      p_color: null,
      p_starts_at: null,
      p_deadline: DEADLINE,
      p_todos: [],
      p_assignee_ids: [] as string[],
      ...overrides,
    } as unknown as Database['public']['Functions']['save_task']['Args']
  }

  async function createTask(assignees: string[] = []) {
    const { data, error } = await adminClient.rpc(
      'save_task',
      saveArgs({ p_assignee_ids: assignees })
    )
    if (error) throw error
    return (data as { id: string }).id
  }

  async function assigneesOf(taskId: string) {
    const { data } = await admin()
      .from('task_assignees')
      .select('official_id')
      .eq('task_id', taskId)
    return (data ?? []).map((r) => r.official_id).sort()
  }

  beforeAll(async () => {
    const tenant = await createTenant('Tasks Tenant')
    tenantId = tenant.id
    const otherTenant = await createTenant('Tasks Other Tenant')
    otherTenantId = otherTenant.id

    const { data: events, error: eventError } = await admin()
      .from('events')
      .insert([
        {
          tenant_id: tenantId,
          name: 'Task Race',
          event_type: 'race',
          start_date: '2026-12-01',
          end_date: '2026-12-01',
        },
        {
          tenant_id: tenantId,
          name: 'Other Race',
          event_type: 'race',
          start_date: '2026-12-02',
          end_date: '2026-12-02',
        },
      ])
      .select('id, name')
    if (eventError) throw eventError
    eventId = events.find((e) => e.name === 'Task Race')!.id
    otherEventId = events.find((e) => e.name === 'Other Race')!.id

    const { data: stages, error: stageError } = await admin()
      .from('event_stages')
      .insert([
        { tenant_id: tenantId, event_id: eventId, name: 'Day 1', stage_type: 'race' },
        { tenant_id: tenantId, event_id: otherEventId, name: 'Day 1', stage_type: 'race' },
      ])
      .select('id, event_id')
    if (stageError) throw stageError
    stageId = stages.find((s) => s.event_id === eventId)!.id
    otherEventStageId = stages.find((s) => s.event_id === otherEventId)!.id

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')
    const otherAdmin = await createUserWithRole(otherTenantId, 'tenant_admin')
    otherTenantAdminClient = await signInAsClient(otherAdmin.phone, '000000')

    const assignee = await createUserWithRole(tenantId, 'official')
    assigneeClient = await signInAsClient(assignee.phone, '000000')
    assigneeOfficialId = await officialIdFor(assignee.userId)

    const colleague = await createUserWithRole(tenantId, 'official')
    colleagueClient = await signInAsClient(colleague.phone, '000000')
    colleagueOfficialId = await officialIdFor(colleague.userId)

    // In the event, but never assigned to a task.
    const outsider = await createUserWithRole(tenantId, 'official')
    outsiderClient = await signInAsClient(outsider.phone, '000000')
    outsiderOfficialId = await officialIdFor(outsider.userId)

    for (const id of [assigneeOfficialId, colleagueOfficialId, outsiderOfficialId]) {
      await addToEvent(id, eventId)
    }
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
    await cleanupTenant(otherTenantId)
  })

  describe('save_task', () => {
    it('creates a task with its assignees and returns exactly { id }', async () => {
      const { data, error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_assignee_ids: [assigneeOfficialId, colleagueOfficialId] })
      )
      expect(error).toBeNull()
      expect(Object.keys(data as object)).toEqual(['id'])
      const taskId = (data as { id: string }).id
      expect(await assigneesOf(taskId)).toEqual([assigneeOfficialId, colleagueOfficialId].sort())

      const { data: task } = await admin().from('tasks').select('*').eq('id', taskId).single()
      expect(task).toMatchObject({
        tenant_id: tenantId,
        event_id: eventId,
        stage_id: stageId,
        name: 'Order bibs',
        done: false,
        starts_at: null,
      })
    })

    it('replaces the assignee list on update', async () => {
      const taskId = await createTask([assigneeOfficialId])
      const { error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_task_id: taskId, p_name: 'Renamed', p_assignee_ids: [colleagueOfficialId] })
      )
      expect(error).toBeNull()
      expect(await assigneesOf(taskId)).toEqual([colleagueOfficialId])
    })

    it('changes nothing when one assignee is invalid (REL-01)', async () => {
      const taskId = await createTask([assigneeOfficialId])

      // Not a member of the event: the whole save must roll back, including
      // the rename that ran before the assignee check would have failed.
      const { data: stranger } = await admin()
        .from('officials')
        .insert({
          tenant_id: tenantId,
          name: 'Not in event',
          phone: `+46701${Math.floor(Math.random() * 1_000_000)}`,
          invite_status: 'confirmed',
        })
        .select('id')
        .single()

      const { error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_task_id: taskId, p_name: 'Should not stick', p_assignee_ids: [stranger!.id] })
      )
      expect(error?.code).toBe('22023')

      const { data: task } = await admin().from('tasks').select('name').eq('id', taskId).single()
      expect(task!.name).toBe('Order bibs')
      expect(await assigneesOf(taskId)).toEqual([assigneeOfficialId])
    })

    it('refuses an unconfirmed official as assignee', async () => {
      const { data: invited } = await admin()
        .from('officials')
        .insert({
          tenant_id: tenantId,
          name: 'Invited',
          phone: `+46701${Math.floor(Math.random() * 1_000_000)}`,
          invite_status: 'invited',
        })
        .select('id')
        .single()
      await addToEvent(invited!.id, eventId)

      const { error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_assignee_ids: [invited!.id] })
      )
      expect(error?.code).toBe('22023')
    })

    it('refuses a stage from another event', async () => {
      const { error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_stage_id: otherEventStageId })
      )
      expect(error?.code).toBe('22023')
    })

    it('refuses a start after the deadline', async () => {
      const { error } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_starts_at: '2026-12-01T11:00:00+00:00' })
      )
      expect(error?.code).toBe('23514')
    })

    it('refuses officials and other tenants’ admins', async () => {
      const { error: officialError } = await assigneeClient.rpc('save_task', saveArgs())
      expect(officialError?.code).toBe('42501')

      const { error: otherError } = await otherTenantAdminClient.rpc('save_task', saveArgs())
      expect(otherError?.code).toBe('42501')
    })
  })

  describe('reading', () => {
    it('lets an official read only tasks they are on, with their co-assignees', async () => {
      const mine = await createTask([assigneeOfficialId, colleagueOfficialId])
      const notMine = await createTask([colleagueOfficialId])

      const { data: tasks } = await assigneeClient
        .from('tasks')
        .select('id')
        .in('id', [mine, notMine])
      expect((tasks ?? []).map((t) => t.id)).toEqual([mine])

      const { data: rows } = await assigneeClient
        .from('task_assignees')
        .select('official_id')
        .eq('task_id', mine)
      expect((rows ?? []).map((r) => r.official_id).sort()).toEqual(
        [assigneeOfficialId, colleagueOfficialId].sort()
      )

      const { data: hidden } = await assigneeClient
        .from('task_assignees')
        .select('official_id')
        .eq('task_id', notMine)
      expect(hidden).toEqual([])

      // The co-assignee sees both tasks they are on.
      const { data: colleagueTasks } = await colleagueClient
        .from('tasks')
        .select('id')
        .in('id', [mine, notMine])
      expect((colleagueTasks ?? []).map((t) => t.id).sort()).toEqual([mine, notMine].sort())

      const { data: outsiderTasks } = await outsiderClient
        .from('tasks')
        .select('id')
        .in('id', [mine, notMine])
      expect(outsiderTasks).toEqual([])
    })

    it('hides every task from another tenant’s admin', async () => {
      const taskId = await createTask()
      const { data } = await otherTenantAdminClient.from('tasks').select('id').eq('id', taskId)
      expect(data).toEqual([])
    })
  })

  describe('writes outside the RPCs', () => {
    it('gives officials no direct write on tasks', async () => {
      const taskId = await createTask([assigneeOfficialId])

      const { error: updateError } = await assigneeClient
        .from('tasks')
        .update({ done: true })
        .eq('id', taskId)
      expect(updateError?.code).toBe('42501')

      const { error: deleteError } = await assigneeClient
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .select()
      // DELETE is granted (for admins); RLS hides the row from an official.
      expect(deleteError).toBeNull()
      const { data: still } = await admin().from('tasks').select('id').eq('id', taskId)
      expect(still).toHaveLength(1)
    })

    it('lets an admin delete a task, taking its assignees with it', async () => {
      const taskId = await createTask([assigneeOfficialId])
      const { error } = await adminClient.from('tasks').delete().eq('id', taskId)
      expect(error).toBeNull()
      expect(await assigneesOf(taskId)).toEqual([])
    })
  })

  describe('set_task_done', () => {
    it('lets an assignee tick a task, returns { id, done, done_at } and logs it once', async () => {
      const taskId = await createTask([assigneeOfficialId])

      const { data, error } = await assigneeClient.rpc('set_task_done', {
        p_task_id: taskId,
        p_done: true,
      })
      expect(error).toBeNull()
      expect(Object.keys(data as object).sort()).toEqual(['done', 'done_at', 'id'])
      expect(data).toMatchObject({ id: taskId, done: true })
      expect((data as { done_at: string | null }).done_at).not.toBeNull()

      // Same value again: no-op, no second trail row.
      await assigneeClient.rpc('set_task_done', { p_task_id: taskId, p_done: true })

      const { data: events } = await admin()
        .from('task_events')
        .select('action, actor_name')
        .eq('task_id', taskId)
      expect(events).toEqual([{ action: 'done', actor_name: 'Test Official' }])
    })

    it('lets an admin untick, clearing done_at', async () => {
      const taskId = await createTask([assigneeOfficialId])
      await assigneeClient.rpc('set_task_done', { p_task_id: taskId, p_done: true })

      const { data, error } = await adminClient.rpc('set_task_done', {
        p_task_id: taskId,
        p_done: false,
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ id: taskId, done: false, done_at: null })

      const { data: events } = await admin()
        .from('task_events')
        .select('action')
        .eq('task_id', taskId)
        .order('created_at')
      expect((events ?? []).map((e) => e.action)).toEqual(['done', 'undone'])
    })

    it('refuses an official who is not on the task, and other tenants', async () => {
      const taskId = await createTask([assigneeOfficialId])

      const { error: outsiderError } = await outsiderClient.rpc('set_task_done', {
        p_task_id: taskId,
        p_done: true,
      })
      expect(outsiderError?.code).toBe('42501')

      const { error: otherError } = await otherTenantAdminClient.rpc('set_task_done', {
        p_task_id: taskId,
        p_done: true,
      })
      expect(otherError?.code).toBe('42501')

      const { data: task } = await admin().from('tasks').select('done').eq('id', taskId).single()
      expect(task!.done).toBe(false)
    })
  })

  describe('checklist', () => {
    async function todosOf(taskId: string) {
      const { data } = await admin()
        .from('task_todos')
        .select('id, instruction_text, position, item_type, checked')
        .eq('task_id', taskId)
        .order('position')
      return data ?? []
    }

    it('keeps ticks when the task is edited, and drops items left out', async () => {
      const { data } = await adminClient.rpc(
        'save_task',
        saveArgs({
          p_assignee_ids: [assigneeOfficialId],
          p_todos: [
            { instruction_text: 'Count bibs', item_type: 'checkbox' },
            { instruction_text: 'Bring tape', item_type: 'checkbox' },
            { instruction_text: 'Boxes are in the shed' },
          ],
        })
      )
      const taskId = (data as { id: string }).id
      const [count, tape, info] = await todosOf(taskId)
      expect(info.item_type).toBe('info')

      const { data: tick, error } = await assigneeClient.rpc('set_task_todo_checked', {
        p_todo_id: count.id,
        p_checked: true,
      })
      expect(error).toBeNull()
      expect(Object.keys(tick as object).sort()).toEqual(['checked', 'checked_at', 'id'])
      expect(tick).toMatchObject({ id: count.id, checked: true })

      // Reorder, rename the ticked one, drop "Bring tape", add a new one.
      const { error: saveError } = await adminClient.rpc(
        'save_task',
        saveArgs({
          p_task_id: taskId,
          p_assignee_ids: [assigneeOfficialId],
          p_todos: [
            { id: info.id, instruction_text: 'Boxes are in the shed' },
            { id: count.id, instruction_text: 'Count all bibs', item_type: 'checkbox' },
            { instruction_text: 'Label boxes', item_type: 'checkbox' },
          ],
        })
      )
      expect(saveError).toBeNull()

      const after = await todosOf(taskId)
      expect(after.map((t) => [t.instruction_text, t.position, t.checked])).toEqual([
        ['Boxes are in the shed', 0, false],
        ['Count all bibs', 1, true],
        ['Label boxes', 2, false],
      ])
      expect(after.find((t) => t.id === tape.id)).toBeUndefined()

      const { data: events } = await admin()
        .from('task_events')
        .select('action, todo_id')
        .eq('task_id', taskId)
      expect(events).toEqual([{ action: 'checked', todo_id: count.id }])
    })

    it('lets an assignee read the checklist, but not an outsider', async () => {
      const { data } = await adminClient.rpc(
        'save_task',
        saveArgs({
          p_assignee_ids: [assigneeOfficialId],
          p_todos: [{ instruction_text: 'Check radios', item_type: 'checkbox' }],
        })
      )
      const taskId = (data as { id: string }).id

      const { data: mine } = await assigneeClient
        .from('task_todos')
        .select('id')
        .eq('task_id', taskId)
      expect(mine).toHaveLength(1)

      const { data: theirs } = await outsiderClient
        .from('task_todos')
        .select('id')
        .eq('task_id', taskId)
      expect(theirs).toEqual([])

      const [todo] = await todosOf(taskId)
      const { error } = await outsiderClient.rpc('set_task_todo_checked', {
        p_todo_id: todo.id,
        p_checked: true,
      })
      expect(error?.code).toBe('42501')
    })

    it('refuses ticking an info item, and an item id from another task', async () => {
      const { data } = await adminClient.rpc(
        'save_task',
        saveArgs({ p_todos: [{ instruction_text: 'Just info' }] })
      )
      const taskId = (data as { id: string }).id
      const [info] = await todosOf(taskId)

      const { error: tickError } = await adminClient.rpc('set_task_todo_checked', {
        p_todo_id: info.id,
        p_checked: true,
      })
      expect(tickError?.code).toBe('22023')

      const otherTaskId = await createTask()
      const { error: moveError } = await adminClient.rpc(
        'save_task',
        saveArgs({
          p_task_id: otherTaskId,
          p_todos: [{ id: info.id, instruction_text: 'Stolen' }],
        })
      )
      expect(moveError?.code).toBe('22023')
      expect((await todosOf(taskId))[0].instruction_text).toBe('Just info')
    })

    it('stores the colour and refuses one outside the palette', async () => {
      const { data } = await adminClient.rpc('save_task', saveArgs({ p_color: 'sky' }))
      const { data: task } = await admin()
        .from('tasks')
        .select('color')
        .eq('id', (data as { id: string }).id)
        .single()
      expect(task!.color).toBe('sky')

      const { error } = await adminClient.rpc('save_task', saveArgs({ p_color: 'neon' }))
      expect(error?.code).toBe('23514')
    })
  })

  describe('membership', () => {
    it('drops an official from their tasks when they leave the event', async () => {
      const { data: leaver } = await admin()
        .from('officials')
        .insert({
          tenant_id: tenantId,
          name: 'Leaver',
          phone: `+46701${Math.floor(Math.random() * 1_000_000)}`,
          invite_status: 'confirmed',
        })
        .select('id')
        .single()
      await addToEvent(leaver!.id, eventId)
      const taskId = await createTask([leaver!.id, assigneeOfficialId])

      await admin()
        .from('official_events')
        .delete()
        .eq('official_id', leaver!.id)
        .eq('event_id', eventId)

      expect(await assigneesOf(taskId)).toEqual([assigneeOfficialId])
    })
  })

  describe('archive lock', () => {
    it('refuses saving and ticking on an archived event', async () => {
      const taskId = await createTask([assigneeOfficialId])
      await admin().from('events').update({ status: 'archived' }).eq('id', eventId)
      try {
        const { error: tickError } = await assigneeClient.rpc('set_task_done', {
          p_task_id: taskId,
          p_done: true,
        })
        expect(tickError?.code).toBe('P0004')

        const { error: saveError } = await adminClient.rpc(
          'save_task',
          saveArgs({ p_task_id: taskId, p_name: 'Late edit' })
        )
        expect(saveError?.code).toBe('P0004')

        const { error: deleteError } = await adminClient.from('tasks').delete().eq('id', taskId)
        expect(deleteError?.code).toBe('P0004')

        // The checklist is the event's setup too: no ticking either.
        const { data: todo } = await admin()
          .from('task_todos')
          .insert({
            task_id: taskId,
            event_id: eventId,
            tenant_id: tenantId,
            instruction_text: 'x',
            position: 0,
            item_type: 'checkbox',
          })
          .select('id')
        expect(todo).toBeNull()
      } finally {
        await admin().from('events').update({ status: 'draft' }).eq('id', eventId)
      }
    })
  })
})
