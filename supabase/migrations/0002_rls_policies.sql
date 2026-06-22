-- 0002_rls_policies.sql
-- Row Level Security — enforces multi-tenant isolation at the database layer

-- Enable RLS on all tables
alter table public.tenants      enable row level security;
alter table public.events       enable row level security;
alter table public.user_roles   enable row level security;
alter table public.officials    enable row level security;
alter table public.participants enable row level security;
alter table public.assignments  enable row level security;
alter table public.announcements enable row level security;

-- Helper: get current user's role for a given tenant
create or replace function public.get_user_role(p_tenant_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from public.user_roles
  where user_id = auth.uid() and tenant_id = p_tenant_id
  limit 1;
$$;

-- Helper: is current user a system admin?
create or replace function public.is_system_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'system_admin'
  );
$$;

-- TENANTS
-- System admin can see and manage all tenants
create policy "system_admin_all_tenants"
  on public.tenants for all
  using (public.is_system_admin());

-- Any authenticated user can read their own tenant
create policy "tenant_member_read"
  on public.tenants for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and tenant_id = tenants.id
    )
  );

-- EVENTS
create policy "tenant_member_read_events"
  on public.events for select
  using (public.get_user_role(tenant_id) is not null);

create policy "tenant_admin_manage_events"
  on public.events for all
  using (public.get_user_role(tenant_id) in ('tenant_admin'));

-- USER ROLES
create policy "system_admin_manage_roles"
  on public.user_roles for all
  using (public.is_system_admin());

create policy "user_read_own_role"
  on public.user_roles for select
  using (user_id = auth.uid());

-- OFFICIALS
create policy "tenant_member_read_officials"
  on public.officials for select
  using (public.get_user_role(tenant_id) is not null);

create policy "tenant_admin_manage_officials"
  on public.officials for all
  using (public.get_user_role(tenant_id) = 'tenant_admin');

-- PARTICIPANTS
create policy "participant_read_own"
  on public.participants for select
  using (user_id = auth.uid());

create policy "tenant_admin_manage_participants"
  on public.participants for all
  using (public.get_user_role(tenant_id) = 'tenant_admin');

-- ASSIGNMENTS
create policy "official_read_own_assignments"
  on public.assignments for select
  using (
    exists (
      select 1 from public.officials
      where officials.id = assignments.official_id
      and officials.user_id = auth.uid()
    )
  );

create policy "tenant_admin_manage_assignments"
  on public.assignments for all
  using (public.get_user_role(tenant_id) = 'tenant_admin');

-- ANNOUNCEMENTS
create policy "tenant_member_read_announcements"
  on public.announcements for select
  using (public.get_user_role(tenant_id) is not null);

create policy "tenant_admin_manage_announcements"
  on public.announcements for all
  using (public.get_user_role(tenant_id) = 'tenant_admin');
