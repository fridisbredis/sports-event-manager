-- ============================================================================
-- Migration 0030: async SMS queue for announcements (PERF-04)
-- ============================================================================
--
-- Bulk-SMS was sent synchronously inside POST /api/announcements — the admin's
-- request blocked until every recipient's Twilio call resolved (or timed
-- out), with no queue, no bounded concurrency, no retry, no idempotency.
--
-- This migration adds sms_queue: one row per (announcement, recipient). The
-- publish route now only inserts these rows and returns immediately; a
-- pg_cron job (same net.http_post pattern as SEC-09's gdpr-warning-sms-trigger,
-- migration 0029) polls the table every minute and asks the app to drain a
-- bounded batch with bounded concurrency. Retry is a plain attempts counter
-- rechecked by the worker's query. Idempotency is the unique constraint on
-- (announcement_id, recipient_phone) — publishing the same announcement
-- twice can't double-enqueue a recipient, and the worker's UPDATE ... WHERE
-- status = 'pending' claim step prevents two overlapping worker runs from
-- double-sending the same row.
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

-- Same posture as rate_limit_hits (0026): not read directly by any client,
-- only by the service role from the worker route. Deny-all + RLS backstop.
revoke all on public.sms_queue from anon, authenticated;
alter table public.sms_queue enable row level security;

-- Claims up to p_batch_size pending rows atomically (SKIP LOCKED avoids two
-- overlapping worker invocations claiming the same row) and flips them to
-- 'sending', returning the claimed rows for the caller to actually send.
-- Failed rows become eligible again automatically: the worker route resets
-- a row's status back to 'pending' after a failed send (up to a max attempt
-- count enforced there), so this function only ever needs to look at
-- status = 'pending'.
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

-- Every minute: ask the app to drain a batch. The route (not this migration)
-- does the actual claiming/sending/retrying — this job only pings it, same
-- division of responsibility as the gdpr-warning-sms-trigger job.
--
-- App URL inlined for the same reason documented in 0029: hosted Supabase's
-- connection role can't ALTER DATABASE/ROLE ... SET custom GUCs on this
-- project (42501 permission denied), so dev and prod each carry their own
-- copy of this cron.schedule call — see the prod migration for
-- sports-event-manager-prod.
--
-- Reuses the same cron_secret Vault entry as gdpr-warning-sms-trigger; no
-- new secret needed.
select cron.schedule(
  'sms-queue-worker-trigger',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://sports-event-manager-dev.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io/api/cron/sms-worker',
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
