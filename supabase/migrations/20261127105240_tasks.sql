-- ============================================================================
-- Migration 20261127105240: tasks per stage (N72)
-- ============================================================================
--
-- A task is a to-do tied to a stage that is not a scheduled shift ("order
-- bibs", "set up finish arch"). It has a name, an optional description, a
-- colour, an optional start, a required deadline, a done flag, a checklist,
-- and 0..n assignees picked from the event's officials. Admins manage tasks on the new Tasks page
-- and see them in a block below the SCHED-01 grid; an assigned official sees
-- their tasks in a block below their shifts in MYSCH-01 and can tick them done.
--
-- WHY NOT A KIND OF WORK AREA. Considered and rejected (Frida, 2026-11-27):
-- a workstations row with kind = 'task' would surface as an empty, unstaffed
-- row in the scheduling grid and coverage, be counted by the onboarding guide,
-- be copied wrong by create_event, and need the per-shift checklist checks
-- reworked — three replacing migrations into working code. A separate table
-- touches none of it; the admin UI reuses the work area form parts instead.
--
-- FOUR TABLES:
--   tasks          — the task. event_id is stored next to stage_id (like
--                    workstations) so RLS and the archive lock read it
--                    without a join.
--   task_assignees — who is on it. One row per (task, official).
--   task_todos     — the checklist, same item types as workstation_todos.
--                    ONE shared list per task, so the check state lives on
--                    the item row itself (checked, checked_at) instead of in
--                    a per-shift table like checklist_item_checks: a task
--                    has no shifts to scope a check to.
--   task_events    — write-once trail: done/undone on the task, and
--                    checked/unchecked on a checklist item (todo_id set).
--                    Same reason as checklist_item_events.
--
-- CONSISTENCY IS IN THE FOREIGN KEYS, not in triggers:
--   tasks (event_id, tenant_id)  -> events (id, tenant_id)
--   tasks (stage_id, tenant_id)  -> event_stages (id, tenant_id)
--   task_assignees (task_id, event_id) -> tasks (id, event_id)
--   task_assignees (official_id, event_id) -> official_events (official_id, event_id)
--   task_todos (task_id, event_id) -> tasks (id, event_id)
-- The last one is the point: an assignee must be a member of the task's
-- event, and when an official leaves the event (remove_official_from_event)
-- or is removed from the tenant, their task_assignees rows cascade away with
-- the official_events row — no RPC elsewhere has to learn about tasks.
-- That the stage belongs to the same event as event_id is checked by
-- save_task(), the only write path for tasks besides delete.
--
-- WRITES. Admins create and edit through save_task() (task, checklist and
-- full assignee list in one transaction, REL-01) and delete with a plain
-- DELETE under tenant_admin_manage_tasks. The done flag changes only through
-- set_task_done(), a checklist item's tick only through
-- set_task_todo_checked(); each writes its flag and the task_events row
-- together. Officials get no write grant on any of the tables: an UPDATE
-- policy scoped to one column would let a caller flip it without the trail.
--
-- save_task keeps checklist items by id (update in place, delete the ones
-- left out, insert new ones) rather than replacing the list like
-- update_workstation does, because the tick lives on the item row: replacing
-- would untick every item each time an admin edits the task.
--
-- NOT event_member_read_<table>. Officials read only the tasks they are
-- assigned to (is_task_assignee), their checklists, and the assignee rows of
-- those tasks — so
-- they see who they share a task with, but not the event's whole task list.
-- The convention's event-wide read would show every official every task;
-- nothing on the official side needs that. Admins read everything through
-- tenant_admin_manage_*.
--
-- ARCHIVE LOCK (z_archive_lock, 20261029085340):
--   tasks, task_todos
--                  every write — the event's setup. Ticking a checklist item
--                  is an update of task_todos, so it is refused too.
--   task_assignees insert and update. Deletes stay open so removing an
--                  official (and the GDPR sweep) still works on an archived
--                  event, the same carve-out as assignments.
--   task_events    insert and update — ticking a task on an archived event
--                  is refused with P0004.
-- The colour list in tasks_color_check is workstations_color_check's
-- (20260930140000); both follow WORK_AREA_COLORS.
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration:
--             drop function if exists public.set_task_todo_checked(uuid, boolean);
--             drop function if exists public.set_task_done(uuid, boolean);
--             drop function if exists public.save_task(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb, uuid[]);
--             drop table if exists public.task_events;
--             drop table if exists public.task_todos;
--             drop table if exists public.task_assignees;
--             drop table if exists public.tasks;
--             drop function if exists public.is_task_assignee(uuid);
--   Data:     no data loss — new tables and functions only. Nothing existing
--             is read or rewritten.
--   Blast:    none for the currently deployed code, which does not know any
--             of these objects exist.
--   Window:   compatible — nothing deployed reads or writes them yet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  event_id    uuid not null,
  stage_id    uuid not null,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  starts_at   timestamptz,
  color       text,
  deadline    timestamptz not null,
  done        boolean not null default false,
  done_at     timestamptz,
  -- Who ticked it, for "done by Anna 14:02" on the official's screen. The
  -- name is denormalised at tick time like task_events.actor_name, so it
  -- survives the account being deleted and needs no join to officials (which
  -- an official can only read for colleagues). Cleared on untick.
  done_by      uuid references auth.users (id) on delete set null,
  done_by_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tasks_color_check check (
    color is null or color in (
      'blush', 'peach', 'sand', 'straw', 'chartreuse',
      'leaf', 'meadow', 'jade', 'seafoam', 'aqua',
      'sky', 'cornflower', 'periwinkle', 'lavender', 'lilac',
      'orchid', 'mauve', 'rose', 'clay', 'tan',
      'wheat', 'olive', 'moss', 'fern', 'sage',
      'mint', 'teal', 'slate', 'iris', 'heather'
    )
  ),
  constraint tasks_starts_before_deadline
    check (starts_at is null or starts_at <= deadline),
  constraint tasks_event_tenant_fkey
    foreign key (event_id, tenant_id) references public.events (id, tenant_id)
    on delete cascade,
  constraint tasks_stage_tenant_fkey
    foreign key (stage_id, tenant_id) references public.event_stages (id, tenant_id)
    on delete cascade,
  -- Target for task_assignees (task_id, event_id).
  constraint tasks_id_event_id_key unique (id, event_id)
);

-- Tasks page and SCHED-01 block: one event's tasks, by deadline.
create index if not exists tasks_event_id_deadline_idx on public.tasks (event_id, deadline);
-- Serves the cascade from event_stages.
create index if not exists tasks_stage_id_idx on public.tasks (stage_id);

comment on table public.tasks is
  'N72: to-dos per stage that are not scheduled shifts. Written through save_task(), set_task_done() and set_task_todo_checked(); deleted directly by admins.';

create table if not exists public.task_assignees (
  task_id     uuid not null,
  official_id uuid not null,
  event_id    uuid not null,
  tenant_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (task_id, official_id),
  constraint task_assignees_task_event_fkey
    foreign key (task_id, event_id) references public.tasks (id, event_id)
    on delete cascade,
  constraint task_assignees_official_event_fkey
    foreign key (official_id, event_id) references public.official_events (official_id, event_id)
    on delete cascade,
  constraint task_assignees_official_tenant_fkey
    foreign key (official_id, tenant_id) references public.officials (id, tenant_id)
    on delete cascade
);

-- MYSCH-01 and is_task_assignee: "my tasks".
create index if not exists task_assignees_official_id_idx on public.task_assignees (official_id);
-- Serves the cascade from official_events.
create index if not exists task_assignees_official_event_idx
  on public.task_assignees (official_id, event_id);

comment on table public.task_assignees is
  'N72: officials assigned to a task. Must be members of the task''s event (FK to official_events, cascades on leave).';

create table if not exists public.task_todos (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null,
  event_id         uuid not null,
  tenant_id        uuid not null,
  instruction_text text not null check (char_length(btrim(instruction_text)) between 1 and 500),
  position         integer not null,
  item_type        text not null default 'info' check (item_type in ('info', 'checkbox')),
  checked          boolean not null default false,
  checked_at       timestamptz,
  -- Same as tasks.done_by / done_by_name: the latest tick's author, cleared
  -- on untick. The full history is in task_events.
  checked_by       uuid references auth.users (id) on delete set null,
  checked_by_name  text,
  created_at       timestamptz not null default now(),
  constraint task_todos_task_event_fkey
    foreign key (task_id, event_id) references public.tasks (id, event_id)
    on delete cascade
);

create index if not exists task_todos_task_id_position_idx on public.task_todos (task_id, position);

comment on table public.task_todos is
  'N72: a task''s checklist. One shared list per task; the tick (checked) lives on the row and changes only through set_task_todo_checked().';

create table if not exists public.task_events (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  -- Set for a checklist item tick, null for the task's own done flag.
  todo_id       uuid references public.task_todos (id) on delete cascade,
  event_id      uuid not null,
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Denormalised at write time, like checklist_item_events.actor_name, so the
  -- trail survives the actor's auth.users row being deleted.
  actor_name    text,
  action        text not null check (action in ('done', 'undone', 'checked', 'unchecked')),
  created_at    timestamptz not null default now(),
  constraint task_events_action_matches_target check (
    (todo_id is null) = (action in ('done', 'undone'))
  )
);

create index if not exists task_events_task_id_created_at_idx
  on public.task_events (task_id, created_at desc);
create index if not exists task_events_tenant_id_idx on public.task_events (tenant_id);

comment on table public.task_events is
  'N72: write-once trail of task done/undone and checklist checked/unchecked ticks. Written only by set_task_done() and set_task_todo_checked().';

-- ----------------------------------------------------------------------------
-- 2. Grants
-- ----------------------------------------------------------------------------
-- REVOKE FIRST: Supabase's default privileges hand every new public table ALL
-- to authenticated and SELECT to anon (see 20261127094110_feedback.sql).
-- service_role keeps its default; the local seed.sql restores it after reset.

revoke all on public.tasks from anon, authenticated;
revoke all on public.task_assignees from anon, authenticated;
revoke all on public.task_todos from anon, authenticated;
revoke all on public.task_events from anon, authenticated;

grant select, delete on public.tasks to authenticated;
grant select on public.task_assignees to authenticated;
grant select on public.task_todos to authenticated;
grant select on public.task_events to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER so the tasks/task_assignees policies calling it do not
-- recurse into task_assignees' own RLS.
create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.task_assignees ta
    join public.officials o on o.id = ta.official_id
    where ta.task_id = p_task_id
      and o.user_id = auth.uid()
      -- Same rule as is_on_workstation_shift: an unconfirmed official is not
      -- on anything yet.
      and o.invite_status = 'confirmed'
  );
$$;

comment on function public.is_task_assignee(uuid) is
  'N72: true when the caller is a confirmed official assigned to the task.';

revoke all on function public.is_task_assignee(uuid) from public, anon;
grant execute on function public.is_task_assignee(uuid) to authenticated;

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_todos enable row level security;
alter table public.task_events enable row level security;

drop policy if exists tenant_admin_manage_tasks on public.tasks;
create policy tenant_admin_manage_tasks on public.tasks
  for all to authenticated
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

drop policy if exists assignee_read_tasks on public.tasks;
create policy assignee_read_tasks on public.tasks
  for select to authenticated
  using (public.is_task_assignee(id));

drop policy if exists tenant_admin_manage_task_assignees on public.task_assignees;
create policy tenant_admin_manage_task_assignees on public.task_assignees
  for all to authenticated
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

-- Every assignee row of a task the caller is on: who they share it with.
drop policy if exists assignee_read_task_assignees on public.task_assignees;
create policy assignee_read_task_assignees on public.task_assignees
  for select to authenticated
  using (public.is_task_assignee(task_id));

drop policy if exists tenant_admin_manage_task_todos on public.task_todos;
create policy tenant_admin_manage_task_todos on public.task_todos
  for all to authenticated
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

drop policy if exists assignee_read_task_todos on public.task_todos;
create policy assignee_read_task_todos on public.task_todos
  for select to authenticated
  using (public.is_task_assignee(task_id));

drop policy if exists tenant_admin_manage_task_events on public.task_events;
create policy tenant_admin_manage_task_events on public.task_events
  for all to authenticated
  using (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin())
  with check (public.get_user_role(tenant_id) = 'tenant_admin' or public.is_system_admin());

-- ----------------------------------------------------------------------------
-- 4. Archive lock
-- ----------------------------------------------------------------------------

drop trigger if exists z_archive_lock on public.tasks;
create trigger z_archive_lock before insert or update or delete on public.tasks
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.task_assignees;
create trigger z_archive_lock before insert or update on public.task_assignees
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.task_todos;
create trigger z_archive_lock before insert or update or delete on public.task_todos
  for each row execute function public.enforce_child_archive_lock();

drop trigger if exists z_archive_lock on public.task_events;
create trigger z_archive_lock before insert or update on public.task_events
  for each row execute function public.enforce_child_archive_lock();

-- ----------------------------------------------------------------------------
-- 5. save_task — create (p_task_id null) or update, with checklist and assignees
-- ----------------------------------------------------------------------------
-- Returns { id }. grep every .rpc('save_task' call site before changing the
-- shape (RPC return-shape contracts, migrations.md).
--
-- p_todos is the full checklist in display order: [{ id?, instruction_text,
-- item_type? }]. An element with an id updates that item (keeping its tick),
-- one without is new, and an existing item left out is deleted. Position
-- comes from array order, as in create_workstation. An id that is not an item
-- of this task is refused (22023), so a caller cannot move another task's
-- item here.
--
-- The role check is in here, not left to the app: SECURITY DEFINER bypasses
-- RLS, so without it any signed-in user could write any tenant's tasks.
-- user_roles is read directly instead of get_user_role(), which returns an
-- arbitrary one of the caller's roles when they hold several in a tenant.

create or replace function public.save_task(
  p_tenant_id    uuid,
  p_event_id     uuid,
  p_task_id      uuid,
  p_stage_id     uuid,
  p_name         text,
  p_description  text,
  p_color        text,
  p_starts_at    timestamptz,
  p_deadline     timestamptz,
  p_todos        jsonb,
  p_assignee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id   uuid;
  v_assignees uuid[] := coalesce(p_assignee_ids, '{}'::uuid[]);
  v_todos     jsonb := coalesce(p_todos, '[]'::jsonb);
begin
  if auth.uid() is null or not (
    coalesce(public.is_system_admin(), false)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = p_tenant_id
        and ur.role = 'tenant_admin'
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if jsonb_typeof(v_todos) <> 'array' then
    raise exception 'Invalid task payload' using errcode = '22023';
  end if;

  -- The stage must belong to this event of this tenant.
  if not exists (
    select 1 from public.event_stages s
    where s.id = p_stage_id
      and s.event_id = p_event_id
      and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Invalid task payload' using errcode = '22023';
  end if;

  -- Every assignee must be a confirmed official of this event. The FK to
  -- official_events already refuses non-members; this adds "confirmed"
  -- (only confirmed officials are schedulable) and one clear error code.
  if exists (
    select 1
    from unnest(v_assignees) as a(official_id)
    where not exists (
      select 1
      from public.official_events oe
      join public.officials o on o.id = oe.official_id
      where oe.official_id = a.official_id
        and oe.event_id = p_event_id
        and o.tenant_id = p_tenant_id
        and o.invite_status = 'confirmed'
    )
  ) then
    raise exception 'Invalid task payload' using errcode = '22023';
  end if;

  if p_task_id is null then
    insert into public.tasks (
      tenant_id, event_id, stage_id, name, description, color, starts_at, deadline
    )
    values (
      p_tenant_id, p_event_id, p_stage_id, btrim(p_name), p_description, p_color,
      p_starts_at, p_deadline
    )
    returning id into v_task_id;
  else
    update public.tasks
    set stage_id    = p_stage_id,
        name        = btrim(p_name),
        description = p_description,
        color       = p_color,
        starts_at   = p_starts_at,
        deadline    = p_deadline,
        updated_at  = now()
    where id = p_task_id
      and tenant_id = p_tenant_id
      and event_id = p_event_id
    returning id into v_task_id;

    if v_task_id is null then
      raise exception 'task not found' using errcode = 'P0002';
    end if;

    delete from public.task_assignees
    where task_id = v_task_id
      and not (official_id = any (v_assignees));
  end if;

  insert into public.task_assignees (task_id, official_id, event_id, tenant_id)
  select distinct v_task_id, a.official_id, p_event_id, p_tenant_id
  from unnest(v_assignees) as a(official_id)
  on conflict (task_id, official_id) do nothing;

  -- Checklist. An id must already be an item of this very task (a new task
  -- has none, so any id on create is refused).
  if exists (
    select 1
    from jsonb_array_elements(v_todos) as t(value)
    where t.value ? 'id'
      and jsonb_typeof(t.value -> 'id') <> 'null'
      and not exists (
        select 1 from public.task_todos tt
        where tt.id = (t.value ->> 'id')::uuid
          and tt.task_id = v_task_id
      )
  ) then
    raise exception 'Invalid task payload' using errcode = '22023';
  end if;

  delete from public.task_todos tt
  where tt.task_id = v_task_id
    and not exists (
      select 1 from jsonb_array_elements(v_todos) as t(value)
      where (t.value ->> 'id')::uuid = tt.id
    );

  -- Turning a ticked checkbox into an info line clears the tick, so it does
  -- not reappear ticked if it is turned back later.
  update public.task_todos tt
  set instruction_text = btrim(t.value ->> 'instruction_text'),
      item_type        = coalesce(t.value ->> 'item_type', 'info'),
      position         = (t.ordinality - 1)::integer,
      checked          = tt.checked and coalesce(t.value ->> 'item_type', 'info') = 'checkbox',
      checked_at       = case
                           when coalesce(t.value ->> 'item_type', 'info') = 'checkbox'
                           then tt.checked_at
                         end,
      checked_by       = case
                           when coalesce(t.value ->> 'item_type', 'info') = 'checkbox'
                           then tt.checked_by
                         end,
      checked_by_name  = case
                           when coalesce(t.value ->> 'item_type', 'info') = 'checkbox'
                           then tt.checked_by_name
                         end
  from jsonb_array_elements(v_todos) with ordinality as t(value, ordinality)
  where tt.task_id = v_task_id
    and tt.id = (t.value ->> 'id')::uuid;

  insert into public.task_todos (
    task_id, event_id, tenant_id, instruction_text, position, item_type
  )
  select
    v_task_id, p_event_id, p_tenant_id,
    btrim(t.value ->> 'instruction_text'),
    (t.ordinality - 1)::integer,
    coalesce(t.value ->> 'item_type', 'info')
  from jsonb_array_elements(v_todos) with ordinality as t(value, ordinality)
  where (t.value ->> 'id') is null;

  return jsonb_build_object('id', v_task_id);
end;
$$;

comment on function public.save_task(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb, uuid[]) is
  'N72: creates (p_task_id null) or updates a task, its checklist and its assignee list in one '
  'transaction. Tenant admins and system admins only. p_todos: [{ id?, instruction_text, item_type? }] '
  'in display order; items keep their tick when sent back with their id. Returns { id }. Raises 42501 '
  '(not admin), 22023 (stage not in the event, an assignee who is not a confirmed official of the '
  'event, or a checklist id not on this task), P0002 (task not found), P0004 (archived event).';

revoke all on function public.save_task(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb, uuid[]) from public, anon;
grant execute on function public.save_task(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. set_task_done — the only way the done flag changes
-- ----------------------------------------------------------------------------
-- Returns { id, done, done_at }. Admins of the task's tenant and its assigned
-- officials may call it. Setting the flag to the value it already has is a
-- no-op that writes no trail row, so two people ticking at once leave one
-- 'done' event, not two.

create or replace function public.set_task_done(p_task_id uuid, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_event_id  uuid;
  v_done      boolean;
  v_done_at   timestamptz;
  v_changed   boolean := false;
  v_actor     text;
begin
  if auth.uid() is null or p_done is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select t.tenant_id, t.event_id into v_tenant_id, v_event_id
  from public.tasks t
  where t.id = p_task_id;

  if v_tenant_id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if not (
    coalesce(public.is_system_admin(), false)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = v_tenant_id
        and ur.role = 'tenant_admin'
    )
    or public.is_task_assignee(p_task_id)
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select o.name into v_actor
  from public.officials o
  where o.user_id = auth.uid() and o.tenant_id = v_tenant_id
  -- A re-invited official holds a 'removed' and a 'confirmed' row for the
  -- same user (migration 0020); take the live one (Sentry VIADAL-EVENT-PROD-6).
  order by (o.invite_status = 'confirmed') desc
  limit 1;

  update public.tasks
  set done         = p_done,
      done_at      = case when p_done then now() end,
      done_by      = case when p_done then auth.uid() end,
      done_by_name = case when p_done then v_actor end,
      updated_at   = now()
  where id = p_task_id
    and done is distinct from p_done
  returning done, done_at into v_done, v_done_at;

  v_changed := found;

  if v_changed then
    insert into public.task_events (task_id, event_id, tenant_id, actor_user_id, actor_name, action)
    values (
      p_task_id, v_event_id, v_tenant_id, auth.uid(), v_actor,
      case when p_done then 'done' else 'undone' end
    );
  else
    select t.done, t.done_at into v_done, v_done_at
    from public.tasks t
    where t.id = p_task_id;
  end if;

  return jsonb_build_object('id', p_task_id, 'done', v_done, 'done_at', v_done_at);
end;
$$;

comment on function public.set_task_done(uuid, boolean) is
  'N72: sets a task''s done flag and records a task_events row in one transaction. Tenant admins, '
  'system admins and the task''s confirmed assignees only. Returns { id, done, done_at }. No-op when '
  'the flag already has the value. Raises 42501, P0002, P0004 (archived event).';

revoke all on function public.set_task_done(uuid, boolean) from public, anon;
grant execute on function public.set_task_done(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. set_task_todo_checked — the only way a checklist item's tick changes
-- ----------------------------------------------------------------------------
-- Returns { id, checked, checked_at }. Same callers and same no-op rule as
-- set_task_done. Only a 'checkbox' item can be ticked (22023 otherwise).

create or replace function public.set_task_todo_checked(p_todo_id uuid, p_checked boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id    uuid;
  v_tenant_id  uuid;
  v_event_id   uuid;
  v_item_type  text;
  v_checked    boolean;
  v_checked_at timestamptz;
  v_actor      text;
begin
  if auth.uid() is null or p_checked is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select tt.task_id, tt.tenant_id, tt.event_id, tt.item_type
  into v_task_id, v_tenant_id, v_event_id, v_item_type
  from public.task_todos tt
  where tt.id = p_todo_id;

  if v_task_id is null then
    raise exception 'checklist item not found' using errcode = 'P0002';
  end if;

  if not (
    coalesce(public.is_system_admin(), false)
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.tenant_id = v_tenant_id
        and ur.role = 'tenant_admin'
    )
    or public.is_task_assignee(v_task_id)
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_item_type <> 'checkbox' then
    raise exception 'checklist item is not a checkbox' using errcode = '22023';
  end if;

  select o.name into v_actor
  from public.officials o
  where o.user_id = auth.uid() and o.tenant_id = v_tenant_id
  -- A re-invited official holds a 'removed' and a 'confirmed' row for the
  -- same user (migration 0020); take the live one (Sentry VIADAL-EVENT-PROD-6).
  order by (o.invite_status = 'confirmed') desc
  limit 1;

  update public.task_todos
  set checked         = p_checked,
      checked_at      = case when p_checked then now() end,
      checked_by      = case when p_checked then auth.uid() end,
      checked_by_name = case when p_checked then v_actor end
  where id = p_todo_id
    and checked is distinct from p_checked
  returning checked, checked_at into v_checked, v_checked_at;

  if found then
    insert into public.task_events (
      task_id, todo_id, event_id, tenant_id, actor_user_id, actor_name, action
    )
    values (
      v_task_id, p_todo_id, v_event_id, v_tenant_id, auth.uid(), v_actor,
      case when p_checked then 'checked' else 'unchecked' end
    );
  else
    select tt.checked, tt.checked_at into v_checked, v_checked_at
    from public.task_todos tt
    where tt.id = p_todo_id;
  end if;

  return jsonb_build_object('id', p_todo_id, 'checked', v_checked, 'checked_at', v_checked_at);
end;
$$;

comment on function public.set_task_todo_checked(uuid, boolean) is
  'N72: ticks or unticks a task checklist item and records a task_events row in one transaction. '
  'Tenant admins, system admins and the task''s confirmed assignees only; checkbox items only. '
  'Returns { id, checked, checked_at }. No-op when the tick already has the value. Raises 42501, '
  'P0002, 22023 (not a checkbox), P0004 (archived event).';

revoke all on function public.set_task_todo_checked(uuid, boolean) from public, anon;
grant execute on function public.set_task_todo_checked(uuid, boolean) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select tgrelid::regclass from pg_trigger where tgname = 'z_archive_lock' and tgrelid::regclass::text like 'task%';
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name in ('tasks', 'task_assignees', 'task_todos', 'task_events') order by 1, 2;
