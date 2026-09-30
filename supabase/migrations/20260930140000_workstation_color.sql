-- ============================================================================
-- Migration 20260930140000: workstations.color — an admin-chosen work-area colour
-- ============================================================================
--
-- Work-area colours were derived in the app from an FNV-1a hash of the work
-- area's id (src/lib/theme/work-area-colors.ts), so nobody could choose one.
-- The point of the colour is to tell areas apart on the schedule, which makes
-- it a judgement the admin has to be able to make. This adds the column the
-- WS-02 colour picker writes to.
--
-- The column stores the palette NAME ('blush', 'iris', …), not a hex value, so
-- re-tuning a shade stays a pure code change. The trade-off is that the set of
-- valid names is a contract between this column and WORK_AREA_COLORS; the
-- CHECK below pins it, and retiring a name means migrating the rows holding it.
--
-- Deliberately NOT unique. Two work areas on a stage sharing a colour is
-- something the picker marks (a dark dot on a taken swatch) but does not
-- forbid — with 30 colours a large event would otherwise hit a hard wall, and
-- a constraint here would turn a cosmetic clash into a failed save.
--
-- BACKFILL. Nullable with no default would have been the smaller migration,
-- but it would leave every existing row rendering through the hash while new
-- rows render from the column — two sources of truth for the same pixel. The
-- backfill below reproduces the app's assignment exactly, so no work area
-- changes colour when this lands. New rows get NULL and still fall back to the
-- hash until an admin picks one (the picker pre-selects the current colour, so
-- the first save just writes down what was already showing).
--
-- The reproduction has to match `workAreaColorMap`, not `workAreaColor`: the
-- map resolves collisions within the rendered set by probing forward from the
-- hashed slot, in sorted-id order. It is grouped BY TENANT because that is how
-- the work-areas list (the broader of the two groupings) calls it. The
-- scheduling grid groups per stage instead, so some work areas DO change
-- colour there — that divergence exists today (one area could already show two
-- different colours in the two views) and collapsing it onto the list's
-- assignment is the point of having a stored colour at all.
--
-- Forward-fix: additive
--   Rollback: `alter table workstations drop column color;` in a new
--             timestamped migration. Cheap — nothing else references it.
--   Data:     Dropping the column loses every admin-chosen colour with no way
--             to recover it (the backfilled values are recomputable from the
--             ids, but anything picked afterwards is not). Export
--             `select id, color from workstations where color is not null`
--             first if the rollback is not immediate.
--   Blast:    Scoped to work-area colour rendering (WS-01/WS-02, SCHED-01,
--             MYSCH-01). Cosmetic only — no scheduling or assignment logic
--             reads it.
--   Window:   Compatible in both orders. The deployed app does not select the
--             column, so it is inert until the new code ships; the new code
--             treats NULL and an unrecognised name identically (falls back to
--             the hash), so it also runs fine against a database where this
--             has been rolled back.
-- ============================================================================

alter table public.workstations
  add column if not exists color text;

comment on column public.workstations.color is
  'Work-area palette name from WORK_AREA_COLORS (src/lib/theme/work-area-colors.ts). '
  'NULL means no colour was chosen; the app falls back to hashing the id. '
  'Not unique — two work areas may deliberately share a colour.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workstations_color_check'
      and conrelid = 'public.workstations'::regclass
  ) then
    alter table public.workstations
      add constraint workstations_color_check check (
        color is null or color in (
          'blush', 'peach', 'sand', 'straw', 'chartreuse',
          'leaf', 'meadow', 'jade', 'seafoam', 'aqua',
          'sky', 'cornflower', 'periwinkle', 'lavender', 'lilac',
          'orchid', 'mauve', 'rose', 'clay', 'tan',
          'wheat', 'olive', 'moss', 'fern', 'sage',
          'mint', 'teal', 'slate', 'iris', 'heather'
        )
      );
  end if;
end $$;

-- ============================================================================
-- Backfill
-- ============================================================================
-- Ports `workAreaColorMap` from TypeScript. Both helpers are dropped at the
-- end: they exist only to make this one UPDATE readable, and leaving a
-- hash function on the schema would invite a second, divergent implementation.

-- FNV-1a over the id, matching `paletteIndex`. The TS version works on
-- charCodeAt (UTF-16 code units) and relies on Math.imul for 32-bit wrapping
-- multiplication; ids here are ASCII uuids, so byte-wise iteration agrees, and
-- the mod 2^32 below is what Math.imul does.
create or replace function pg_temp.work_area_palette_index(p_id text)
returns integer
language plpgsql
immutable
as $$
declare
  v_hash bigint := 2166136261;  -- 0x811c9dc5
  i      integer;
begin
  for i in 1 .. length(p_id) loop
    v_hash := (v_hash # ascii(substr(p_id, i, 1)))::bigint;
    v_hash := (v_hash * 16777619) % 4294967296;  -- 0x01000193, mod 2^32
  end loop;
  return (v_hash % 30)::integer;
end $$;

-- The ordered palette, by index. Must stay in step with WORK_AREA_COLORS.
create or replace function pg_temp.work_area_palette_name(p_index integer)
returns text
language sql
immutable
as $$
  select (array[
    'blush', 'peach', 'sand', 'straw', 'chartreuse',
    'leaf', 'meadow', 'jade', 'seafoam', 'aqua',
    'sky', 'cornflower', 'periwinkle', 'lavender', 'lilac',
    'orchid', 'mauve', 'rose', 'clay', 'tan',
    'wheat', 'olive', 'moss', 'fern', 'sage',
    'mint', 'teal', 'slate', 'iris', 'heather'
  ])[p_index + 1];
$$;

do $$
declare
  v_tenant     record;
  v_workstation record;
  v_taken      boolean[];
  v_first      integer;
  v_index      integer;
  v_step       integer;
  v_candidate  integer;
begin
  for v_tenant in select distinct tenant_id from public.workstations loop
    -- One slot per palette entry, false = free. Reset per tenant, mirroring
    -- the app calling the map once per rendered list.
    v_taken := array_fill(false, array[30]);

    -- Sorted id order, exactly as `workAreaColorMap` sorts before probing —
    -- this is what makes the assignment independent of row order. Postgres
    -- sorts uuid::text under the database collation; the ids are lowercase
    -- hex with dashes, where every collation agrees with JS's code-unit
    -- ordering, so the two sorts match.
    for v_workstation in
      select id
      from public.workstations
      where tenant_id = v_tenant.tenant_id
      order by id::text collate "C"
    loop
      v_first := pg_temp.work_area_palette_index(v_workstation.id::text);
      v_index := v_first;

      for v_step in 0 .. 29 loop
        v_candidate := (v_first + v_step) % 30;
        if not v_taken[v_candidate + 1] then
          v_index := v_candidate;
          exit;
        end if;
      end loop;

      v_taken[v_index + 1] := true;

      update public.workstations
         set color = pg_temp.work_area_palette_name(v_index)
       where id = v_workstation.id;
    end loop;
  end loop;
end $$;

drop function pg_temp.work_area_palette_index(text);
drop function pg_temp.work_area_palette_name(integer);
