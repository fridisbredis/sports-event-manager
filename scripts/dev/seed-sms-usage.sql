-- ============================================================================
-- Demo data for the N24 SMS spend UI — LOCAL STACK ONLY
-- ============================================================================
--
-- The spend column and the dashboard card have three states, and an empty
-- sms_usage table shows only one of them. This fills in the other two so all
-- three can be seen side by side:
--
--   under      — muted, no bar          (the state ~11 months of the year)
--   approaching — amber, bar appears    (>= 80% of the tier cap)
--   blocked    — red + "Blocked"        (at or over the cap; sending stopped)
--
-- WHY IT ADDS TENANTS. A tenant's cap comes from its tier, so showing the
-- three states at once needs more than one tier in the table. The seed has a
-- single standard tenant; this adds a premium and a professional one beside
-- it.
--
-- LOCAL ONLY. Run it against the local stack, never dev or prod:
--
--   psql "$(supabase status -o json | python3 -c \
--     "import json,sys; print(json.load(sys.stdin)['DB_URL'])")" \
--     -f scripts/dev/seed-sms-usage.sql
--
-- `supabase db reset` removes everything this inserts. Re-running it is safe:
-- the tenants upsert on slug and the usage rows are deleted first.
--
-- The segment counts below are derived from the cap and the rate in
-- src/lib/sms/cost.ts (0.70 SEK/segment unless SMS_SEK_PER_SEGMENT is set).
-- If you have set that env var to something else, the displayed SEK will
-- differ from the comments here — the ratios against each cap still hold.
-- ============================================================================

begin;

-- Two extra tenants, so the three tier caps (100 / 200 / 300) are all present.
insert into tenants (name, slug, tier, is_active)
values
  ('Demo Premium', 'demo-premium', 'premium', true),
  ('Demo Professional', 'demo-professional', 'professional', true)
on conflict (slug) do update
  set tier = excluded.tier,
      is_active = excluded.is_active;

-- Clear this month's rows for the three tenants so re-running does not stack
-- spend on top of the previous run and push everything into "blocked".
delete from sms_usage
where created_at >= date_trunc('month', now() at time zone 'utc')
  and tenant_id in (
    select id from tenants
    where slug in ('seed-klubben', 'demo-premium', 'demo-professional')
  );

-- UNDER THE CAP — professional, 300 kr cap.
-- 80 segments ≈ 56 kr, a little under a fifth. Roughly what a real event
-- costs: invites to 15 officials plus a couple of announcements.
insert into sms_usage (tenant_id, kind, status, segments, created_at)
select t.id, 'announcement', 'sent', 1, now() - (n || ' minutes')::interval
from tenants t, generate_series(1, 80) n
where t.slug = 'demo-professional';

-- APPROACHING — premium, 200 kr cap.
-- 240 segments ≈ 168 kr, about 84%: past the 80% threshold, so the bar and
-- the amber chip appear while there is still room to send.
insert into sms_usage (tenant_id, kind, status, segments, created_at)
select t.id, 'announcement', 'sent', 1, now() - (n || ' minutes')::interval
from tenants t, generate_series(1, 240) n
where t.slug = 'demo-premium';

-- BLOCKED — standard, 100 kr cap.
-- 200 segments ≈ 140 kr, well past it. This is the tenant whose invites and
-- announcements have actually stopped.
insert into sms_usage (tenant_id, kind, status, segments, created_at)
select t.id, 'announcement', 'sent', 1, now() - (n || ' minutes')::interval
from tenants t, generate_series(1, 200) n
where t.slug = 'seed-klubben';

-- A handful of failed sends on the blocked tenant. Twilio does not charge for
-- a message it refused, so these must NOT move the SEK figure — worth having
-- in the data so that stays visible rather than assumed.
insert into sms_usage (tenant_id, kind, status, segments, created_at)
select t.id, 'announcement', 'failed', 2, now() - (n || ' minutes')::interval
from tenants t, generate_series(1, 5) n
where t.slug = 'seed-klubben';

commit;

-- What the UI should now show. The SEK here is computed with the same 0.70
-- the app uses by default, so these numbers are what you should see on screen.
select
  t.name,
  t.tier,
  sum(u.segments) filter (where u.status = 'sent') as billable_segments,
  round(sum(u.segments) filter (where u.status = 'sent') * 0.70) as approx_sek,
  case t.tier
    when 'standard' then 100 when 'premium' then 200 when 'professional' then 300
  end as cap_sek,
  count(*) filter (where u.status = 'failed') as failed_not_charged
from tenants t
join sms_usage u on u.tenant_id = t.id
where u.created_at >= date_trunc('month', now() at time zone 'utc')
group by t.id, t.name, t.tier
order by t.tier;
