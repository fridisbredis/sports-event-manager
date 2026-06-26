-- ============================================================================
-- Migration 0004: Consolidate RLS policies — include system_admin, unify style
-- ============================================================================
--
-- Two problems being fixed:
--
-- 1. Policies from 0002 (announcements, events, officials, assignments,
--    participants) only allow tenant_admin, not system_admin.
--    requireTenantAdmin() in src/lib/auth/tenant.ts allows system_admin to
--    pass the app-level check, so the DB layer must match.
--
-- 2. Policies from 0003 (event_stages, workstations,
--    workstation_operating_windows, workstation_todos) use a different style
--    (direct subquery on user_roles) instead of the get_user_role() helper.
--    They also have only one FOR ALL policy, giving tenant members write
--    access — wrong. Only tenant_admin (or system_admin) should manage.
--
-- Defensive: uses DROP POLICY IF EXISTS so can be re-run.
--
-- After this migration, every RLS policy follows the same pattern:
--   manage (ALL): role = 'tenant_admin' OR is_system_admin()
--   read   (SELECT): role IS NOT NULL OR is_system_admin()
-- (with table-specific exceptions for own-data access where they apply)
-- ============================================================================


-- ============================================================================
-- Part A: Add system_admin to existing policies (0002 tables)
-- ============================================================================

-- ---- announcements ----
drop policy if exists "tenant_admin_manage_announcements" on public.announcements;
create policy "tenant_admin_manage_announcements"
  on public.announcements for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

drop policy if exists "tenant_member_read_announcements" on public.announcements;
create policy "tenant_member_read_announcements"
  on public.announcements for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- ---- events ----
drop policy if exists "tenant_admin_manage_events" on public.events;
create policy "tenant_admin_manage_events"
  on public.events for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

drop policy if exists "tenant_member_read_events" on public.events;
create policy "tenant_member_read_events"
  on public.events for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- ---- officials ----
drop policy if exists "tenant_admin_manage_officials" on public.officials;
create policy "tenant_admin_manage_officials"
  on public.officials for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

drop policy if exists "tenant_member_read_officials" on public.officials;
create policy "tenant_member_read_officials"
  on public.officials for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- ---- assignments ----
-- (official_read_own_assignments policy stays as-is — it's for officials
-- reading their own data, independent of admin/system_admin)
drop policy if exists "tenant_admin_manage_assignments" on public.assignments;
create policy "tenant_admin_manage_assignments"
  on public.assignments for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

-- ---- participants ----
-- (participant_read_own stays as-is)
drop policy if exists "tenant_admin_manage_participants" on public.participants;
create policy "tenant_admin_manage_participants"
  on public.participants for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );


-- ============================================================================
-- Part B: Rework 0003 policies — unify style, split manage/read, add system_admin
-- ============================================================================

-- ---- event_stages ----
drop policy if exists "event_stages_tenant_isolation" on public.event_stages;

create policy "tenant_admin_manage_event_stages"
  on public.event_stages for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

create policy "tenant_member_read_event_stages"
  on public.event_stages for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- ---- workstations ----
drop policy if exists "workstations_tenant_isolation" on public.workstations;

create policy "tenant_admin_manage_workstations"
  on public.workstations for all
  using (
    public.get_user_role(tenant_id) = 'tenant_admin'
    or public.is_system_admin()
  );

create policy "tenant_member_read_workstations"
  on public.workstations for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- ---- workstation_operating_windows ----
-- No tenant_id column directly; check through workstation
drop policy if exists "workstation_op_windows_tenant_isolation"
  on public.workstation_operating_windows;

create policy "tenant_admin_manage_workstation_op_windows"
  on public.workstation_operating_windows for all
  using (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_id
        and (
          public.get_user_role(w.tenant_id) = 'tenant_admin'
          or public.is_system_admin()
        )
    )
  );

create policy "tenant_member_read_workstation_op_windows"
  on public.workstation_operating_windows for select
  using (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_id
        and (
          public.get_user_role(w.tenant_id) is not null
          or public.is_system_admin()
        )
    )
  );

-- ---- workstation_todos ----
drop policy if exists "workstation_todos_tenant_isolation"
  on public.workstation_todos;

create policy "tenant_admin_manage_workstation_todos"
  on public.workstation_todos for all
  using (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_id
        and (
          public.get_user_role(w.tenant_id) = 'tenant_admin'
          or public.is_system_admin()
        )
    )
  );

create policy "tenant_member_read_workstation_todos"
  on public.workstation_todos for select
  using (
    exists (
      select 1 from public.workstations w
      where w.id = workstation_id
        and (
          public.get_user_role(w.tenant_id) is not null
          or public.is_system_admin()
        )
    )
  );


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- Expected: every tenant-scoped table has either
--   - tenant_admin_manage_<table> (ALL) + tenant_member_read_<table> (SELECT)
--   - or a similar pattern with system_admin allowed
