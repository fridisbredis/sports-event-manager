-- ============================================================================
-- Migration 20261030084025: sms_cap_warnings
-- ============================================================================
--
-- N32 (Peter, 2026-10-29): when a tenant reaches 90% of its tier's monthly
-- SMS cost cap (N24), text every tenant admin of that tenant and every system
-- admin — ONCE per tenant and calendar month.
--
-- This table is the "once". One row per tenant and month that has been
-- warned. The primary key on (tenant_id, month) is what makes the warning
-- go out once even when two SMS-worker ticks overlap: the worker INSERTs the
-- row before sending, and only the tick whose insert succeeds sends. The
-- other gets a unique violation and skips.
--
-- Claim before send, not after. Sending first and recording after would
-- double-text every admin whenever the record write failed or two ticks
-- raced. The cost of claiming first is that a tick dying between the claim
-- and the send loses that month's warning — the app releases the claim when
-- every send failed (see src/lib/sms/cap-warning.ts), which covers the
-- Twilio-is-down case; a process killed mid-send does not get a retry.
--
-- WHY NOT sms_usage
-- Peter's rule 5: the warning does NOT count toward the tenant's SMS cost.
-- sms_usage is exactly the tenant's cost — every reader sums it into the cap
-- — so the warning is deliberately not written there. Its segments are
-- recorded on this row instead, so the Twilio invoice can still be
-- reconciled against what the app sent.
--
-- `month` is the first day of the UTC calendar month, matching
-- startOfMonthUtc() in src/lib/sms/cost.ts — the same boundary the cap
-- itself resets on.
--
-- Forward-fix: additive
--   Rollback: drop table if exists public.sms_cap_warnings;
--   Data:     no data loss that matters — the rows only record which tenants
--             were warned this month. Dropping it mid-month means a tenant
--             already over 90% is warned a second time by an image that
--             still uses the table; by an image that does not, never.
--   Blast:    none to sending. The warning code fails closed on this table
--             (no claim, no SMS) and runs after the worker's own sends, so a
--             missing or broken table stops warnings only, never
--             announcements.
--   Window:   compatible — additive; the currently deployed image never
--             reads or writes it.
-- ============================================================================

create table if not exists public.sms_cap_warnings (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  month         date not null,

  -- Filled in after the sends. Null between claim and completion, and
  -- left null if the tick died in between — which is how such a row can be
  -- told apart from a warning that went out.
  sent_count    int,
  failed_count  int,
  -- Billable segments across the sent warnings, for invoice reconciliation
  -- (these are excluded from sms_usage on purpose — see header).
  segments      int,

  created_at    timestamptz not null default now(),

  primary key (tenant_id, month)
);

-- Same posture as sms_usage: written and read only by the service role from
-- the SMS worker. Deny-all plus RLS as a backstop.
revoke all on public.sms_cap_warnings from anon, authenticated;
alter table public.sms_cap_warnings enable row level security;

comment on table public.sms_cap_warnings is
  'One row per tenant and UTC calendar month in which the N32 90%-of-SMS-cap '
  'warning was sent to its admins and the system admins. The primary key is '
  'the once-per-month guarantee. Warning SMS are NOT in sms_usage: they do not '
  'count toward the tenant''s cap.';
