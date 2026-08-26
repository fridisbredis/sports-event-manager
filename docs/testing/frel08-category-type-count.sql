-- F-REL-08 evidence query. READ-ONLY — only SELECT, no writes.
--
-- Background: migration 0008_race_type_on_stages.sql backfilled
-- event_stages.race_type from events.category_type WHERE stage_type = 'race',
-- then dropped events.category_type unconditionally in the same file. An event
-- with no race stage would therefore have carried its category_type into the
-- drop unmigrated, with no way to read it back.
--
-- Result 2026-08-26 (dev lhflutwvwvzawzbcuwup, prod rauvaxuypujbeintnnoe):
--
--   metric                      | dev        | prod
--   ----------------------------|------------|------------
--   events without race stage   | 0          | 0
--   events total                | 5          | 5
--   race stages distance / time | 3 / 7      | 3 / 2
--
-- Closed as latent-but-never-realised. Note also that migration 0006 created
-- category_type as NOT NULL DEFAULT 'distance', so 0008's
-- "AND e.category_type IS NOT NULL" guard never filtered anything — the
-- backfill reached every race stage that existed at the time.
--
-- Re-run this if event_stages data is ever bulk-imported from an older source.

-- 1. Exposure: events whose stage set contains no race stage. These are the
--    only events whose category_type could have been lost. Expected: 0.
select
  'events_without_race_stage' as metric,
  count(*)                    as events,
  count(*) filter (where s.total_stages = 0) as of_which_have_no_stages_at_all
from events e
left join (
  select
    event_id,
    count(*)                                    as total_stages,
    count(*) filter (where stage_type = 'race') as race_stages
  from event_stages
  group by event_id
) s on s.event_id = e.id
where coalesce(s.race_stages, 0) = 0;

-- 2. Corroboration: the race_type distribution. Any 'time' row proves the
--    backfill landed rather than silently defaulting everything to 'distance'.
select
  race_type,
  count(*)                 as race_stages,
  count(distinct event_id) as events
from event_stages
where stage_type = 'race'
group by race_type
order by race_type;

-- 3. Scale context. A small table means any correction would be a manual
--    conversation with the tenant admin, not a migration.
select
  'totals' as metric,
  (select count(*) from events)                                 as events,
  (select count(*) from event_stages)                           as stages,
  (select count(*) from event_stages where stage_type = 'race')  as race_stages,
  (select count(*) from event_distances)                        as distances;
