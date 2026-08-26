-- ============================================================================
-- Migration 0030 (prod variant): async SMS queue for announcements (PERF-04)
-- ============================================================================
--
-- Identical to 0030_sms_queue.sql (dev), except the sms-queue-worker-trigger
-- cron job points at the prod app URL instead of dev's. Lives in
-- supabase/prod-manual-migrations/ (NOT supabase/migrations/) for the same
-- reason as 0029's prod variant: dev and prod are entirely separate
-- Supabase projects with no shared migration history, and both files
-- sharing version 0030 would collide in schema_migrations if this lived
-- alongside the dev migration. Apply this to the PROD project only, via the
-- Supabase SQL editor or MCP, after 0029 (prod) has already been applied.
--
-- Reuses the existing prod cron_secret Vault entry set up for 0029 — no new
-- secret needed.
-- ============================================================================

create table if not exists public.sms_queue (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  announcement_id  uuid not null references public.announcements(id) on delete cascade,
  recipient_phone  text not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts         int not null default 0,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (announcement_id, recipient_phone)
);

create index if not exists sms_queue_pending_idx
  on public.sms_queue (created_at)
  where status = 'pending';

revoke all on public.sms_queue from anon, authenticated;
alter table public.sms_queue enable row level security;

create or replace function public.claim_sms_queue_batch(p_batch_size int)
returns setof public.sms_queue
language sql
security definer
set search_path = public
as $$
  update public.sms_queue
  set status = 'sending', updated_at = now()
  where id in (
    select id from public.sms_queue
    where status = 'pending'
    order by created_at
    limit p_batch_size
    for update skip locked
  )
  returning *;
$$;

revoke all on function public.claim_sms_queue_batch(int) from public, anon, authenticated;
grant execute on function public.claim_sms_queue_batch(int) to service_role;

-- Prod app URL per CLAUDE.md: custom domain is primary.
select cron.schedule(
  'sms-queue-worker-trigger',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://app.viadalevent.se/api/cron/sms-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select jobname, schedule, active from cron.job where jobname = 'sms-queue-worker-trigger';
--   select proname from pg_proc where proname = 'claim_sms_queue_batch';
