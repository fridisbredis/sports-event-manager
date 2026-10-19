-- ============================================================================
-- Migration 20261019093632: per-tenant SMS usage accounting
-- ============================================================================
--
-- N11 asks for an SMS cost cap per tier, in SEK, per month and per event, with
-- sending stopped and the system admin warned when a tenant reaches it.
--
-- This migration builds the MEASUREMENT half only. No cap is enforced and no
-- send is blocked by anything here.
--
-- WHY MEASUREMENT FIRST
-- A cap needs a number, and nobody knows what an event actually costs: nothing
-- in this system has ever counted an SMS per tenant. SYS-03's health card
-- queries Twilio's API for today's count from one sender number — it is not
-- per tenant, it is not stored, and it stops paging at 250 messages, so it
-- cannot be the basis for a billing decision. Setting a SEK cap today would be
-- inventing a threshold and then enforcing it. One event's real data turns
-- that into an informed choice, and the data has to be collected before it can
-- be read.
--
-- WHAT IS RECORDED
-- One row per message we hand to Twilio, written at the point of send by the
-- four routes that send: officials invite, invite resend, the GDPR inactivity
-- warning cron, and the announcement queue worker. Every one of them already
-- has tenant_id in hand (verified by reading all four), so attribution needs
-- no new plumbing.
--
-- WHY SEGMENTS AND NOT PRICE
-- Twilio bills per SEGMENT, not per message: 160 GSM-7 characters, or 70 when
-- the body contains anything outside GSM-7 (a Swedish å, ä or ö in an
-- announcement halves the budget). The invite SMS is already documented in
-- officials/route.ts as two segments on prod because of the URL length.
--
-- Twilio returns `num_segments` on the create response and we store it. It
-- also returns `price` — but that field is null at create time and only
-- populated once the message reaches a terminal delivery state, so a price
-- captured here would be null on nearly every row. SEK is therefore derived at
-- read time from segments × a configured per-segment rate, and the rate lives
-- in app config rather than here: it changes when Twilio's pricing changes,
-- and a historical total must not silently move when it does.
--
-- `price` and `price_unit` are stored anyway when Twilio does return them, so
-- a later reconciliation job can compare what we derived against what Twilio
-- actually charged. Nothing reads them yet.
--
-- WHAT IS NOT COUNTED, AND WHY IT MATTERS FOR THE CAP
-- Login OTP messages are sent by Supabase Auth (`signInWithOtp`), not by our
-- Twilio client. We never see that HTTP call, so it cannot be recorded here
-- and will not appear in any per-tenant total — it only shows on the Twilio
-- invoice. This is a real gap in the cap's coverage and it needs to be said
-- out loud rather than discovered later: a tenant's measured spend is its
-- announcement, invite and GDPR-warning traffic, not its login traffic.
--
-- It also happens to be the right place for the gap to be. Frida's decision
-- (2026-10-19) is that the cap must never stop OTP: blocking login locks
-- everyone out of the app, including the admin who needs to get in to see the
-- warning and act on it. A category of message that must never be blocked is
-- one whose absence from the ledger costs nothing operationally — but the SEK
-- figure is an undercount, and whatever threshold is eventually set has to be
-- chosen in that knowledge.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.sms_usage;
--   Data:     the usage history is lost and cannot be reconstructed — Twilio's
--             Messages API has no tenant attribution, which is the whole
--             reason this table exists. Nothing else depends on it: no
--             foreign key points at it and no send path reads it.
--   Blast:    none. The table is written to but never read by the send paths,
--             so a failed insert is logged and the message still goes out
--             (recording a send must never prevent one).
--   Window:   compatible — additive, old code keeps working unmodified.
-- ============================================================================

create table if not exists public.sms_usage (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  -- What prompted the message. Not a foreign key to anything: 'announcement'
  -- rows outlive the announcement when a tenant deletes it, and the usage
  -- history must survive that — a deleted announcement does not refund its
  -- SMS. `kind` is a CHECK rather than an enum so adding a sixth sender later
  -- is a one-line migration, matching how sms_queue.status is done.
  kind          text not null
                  check (kind in ('invite', 'invite_resend', 'announcement', 'gdpr_warning')),

  -- Twilio's own identifier for the message, for reconciliation against an
  -- invoice. Nullable: a send that threw before Twilio answered has no sid,
  -- and those rows are still worth having (see `status`).
  message_sid   text,

  -- Twilio's num_segments from the create response. This is the billable
  -- unit. Defaults to 1 rather than 0 so a send whose response was unreadable
  -- is counted as costing something rather than nothing — undercounting spend
  -- is the more dangerous error for a table that will eventually back a cap.
  segments      int not null default 1 check (segments >= 1),

  -- Whether Twilio accepted the message. A failed send is kept: it did not
  -- cost money, but a tenant generating hundreds of failures is a problem
  -- worth seeing, and excluding them would make the row count disagree with
  -- the send-attempt count for no visible reason.
  status        text not null
                  check (status in ('sent', 'failed')),

  -- Twilio's own price, when it gives one. Almost always null at create time
  -- (it is set on delivery), so nothing derives SEK from this — it exists for
  -- a later reconciliation job. Numeric, not text: Twilio returns a string
  -- like "-0.0685", and storing it as text would invite string arithmetic.
  price         numeric(12, 6),
  price_unit    text,

  created_at    timestamptz not null default now()
);

-- The read pattern the cap will use: one tenant's usage over a time window.
-- tenant_id first, then created_at, so a month-to-date sum for one tenant is
-- an index range scan rather than a filter over the whole table.
create index if not exists sms_usage_tenant_created_idx
  on public.sms_usage (tenant_id, created_at desc);

-- Same posture as sms_queue (0030) and rate_limit_hits (0026): written only
-- by the service role from the send routes, never read by a browser client.
-- Deny-all plus an RLS backstop, so a future PostgREST grant cannot
-- accidentally expose one tenant's spend to another.
revoke all on public.sms_usage from anon, authenticated;
alter table public.sms_usage enable row level security;

comment on table public.sms_usage is
  'One row per SMS handed to Twilio, for per-tenant cost accounting (N11). '
  'Does NOT include login OTP messages, which Supabase Auth sends directly '
  'and we never observe. Segments are the billable unit; SEK is derived at '
  'read time from a configured per-segment rate, never stored.';
