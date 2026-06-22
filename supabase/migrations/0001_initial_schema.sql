-- 0001_initial_schema.sql
-- Run against both dev and prod Supabase projects

-- Tenants (one per event in v1)
create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  is_active    boolean not null default true,
  tier         text not null default 'standard' check (tier in ('standard', 'premium', 'professional')),
  feature_flags jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- Events
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,
  event_type   text not null,
  start_date   date not null,
  end_date     date not null,
  location     text,
  description  text,
  logo_url     text,
  created_at   timestamptz not null default now()
);

-- User roles per tenant
create table public.user_roles (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role      text not null check (role in ('system_admin', 'tenant_admin', 'official', 'participant')),
  unique (user_id, tenant_id)
);

-- Officials
create table public.officials (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  phone         text not null,
  invite_status text not null default 'pending' check (invite_status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now()
);

-- Participants
create table public.participants (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  name            text not null,
  phone           text not null,
  bib             text,
  category        text,
  race_results_url text,
  created_at      timestamptz not null default now()
);

-- Assignments (workstation + timeslot + todo per official)
create table public.assignments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  official_id    uuid not null references public.officials(id) on delete cascade,
  workstation    text not null,
  timeslot_start timestamptz not null,
  timeslot_end   timestamptz not null,
  todo           text,
  created_at     timestamptz not null default now()
);

-- Announcements
create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  channel      text not null check (channel in ('officials', 'participants')),
  body         text not null,
  sms_sent     boolean not null default false,
  published_at timestamptz not null,
  created_at   timestamptz not null default now()
);

-- Indexes
create index on public.events (tenant_id);
create index on public.officials (tenant_id);
create index on public.participants (tenant_id);
create index on public.assignments (tenant_id);
create index on public.announcements (tenant_id);
create index on public.user_roles (user_id);
