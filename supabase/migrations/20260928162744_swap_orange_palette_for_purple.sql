-- ============================================================================
-- Migration: allow 'purple' as a tenant color palette, drop 'orange'
-- ============================================================================
--
-- Part of the admin-dashboard color update
-- (docs/design_handoff_admin_dashboard/), which re-themed the UI so every
-- theme color clears WCAG 2.2 AA: text at 4.5:1 against white, UI borders at
-- 3:1. Three things came out of that round, and this migration carries the
-- only one of them the database can see:
--
--   1. Most colors were re-tuned in lightness, hue preserved. Code-side only.
--   2. The 'green' key's primary and accent sat at 2.42:1 and 2.77:1 — too far
--      under to fix by lightness alone — so it was replaced with a teal. The
--      key is still spelled 'green' because it is a stored value, and renaming
--      it would mean rewriting rows in every environment for a cosmetic gain.
--      Also code-side only: the key did not change.
--   3. The orange palette is retired and a purple one takes its place. All
--      three of orange's roles were under AA; rather than re-tune a palette
--      nobody was using, it was dropped and purple added (5.70:1, 7.90:1,
--      6.32:1). This one DOES change the set of legal keys, which migration
--      0016 pinned in a CHECK constraint — hence this migration.
--
-- The hex values themselves live in src/lib/theme/tenant-colors.ts and are
-- emitted as CSS custom properties by TenantThemeStyle — never stored here.
-- The column comment below exists to stop the next person reading a bare
-- `text` column named `color_palette` as somewhere a hex value belongs.
--
-- Verified immediately before writing, on both environments:
--   dev  (lhflutwvwvzawzbcuwup): blue 3, green 4, orange 0
--   prod (rauvaxuypujbeintnnoe): blue 4, green 1, orange 0
-- No row holds 'orange' in either database, so narrowing the constraint
-- rewrites nothing and cannot fail validation. The one dev tenant that used
-- orange ('micke-testar') was moved to green by hand before this was written.
--
-- The guard below is not decoration: if any environment this runs against
-- still has an orange row, the ALTER would fail on validation with a
-- constraint-violation error that says nothing useful about why. The RAISE
-- turns that into an actionable message instead.
--
-- Forward-fix: replace
--   Rollback: re-create the previous constraint —
--             ALTER TABLE public.tenants
--               DROP CONSTRAINT tenants_color_palette_check;
--             ALTER TABLE public.tenants
--               ADD CONSTRAINT tenants_color_palette_check
--               CHECK (color_palette IN ('blue', 'green', 'orange'));
--             Any tenant switched to 'purple' after this migration must be
--             moved off it first, or that rollback fails validation.
--   Data:     none rewritten. The constraint is swapped, not the rows.
--   Blast:    a tenant whose palette key is not recognized by the running app
--             falls back to DEFAULT_TENANT_PALETTE rather than throwing, so an
--             old app build meeting a 'purple' row degrades to blue instead of
--             breaking. Nothing can write 'purple' until the new build ships.
--   Window:   deploy in either order. The constraint change is backward
--             compatible with the old build (which never writes 'purple'), and
--             the new build's palette list is code-side only.
-- ============================================================================

DO $$
DECLARE
  orange_count integer;
BEGIN
  SELECT count(*) INTO orange_count
  FROM public.tenants
  WHERE color_palette = 'orange';

  IF orange_count > 0 THEN
    RAISE EXCEPTION
      'Cannot drop the orange palette: % tenant(s) still use it. '
      'Move them to another palette first (see tenants.color_palette).',
      orange_count;
  END IF;
END $$;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_color_palette_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_color_palette_check
    CHECK (color_palette IN ('blue', 'green', 'purple'));

COMMENT ON COLUMN public.tenants.color_palette IS
  'Key into TENANT_PALETTES in src/lib/theme/tenant-colors.ts — one of blue, '
  'green, purple. Stores the key only: the hex/HSL values for each theme, '
  'including the hover and tint tokens, live in that file and are emitted as '
  'CSS custom properties by TenantThemeStyle. Do not store color values in '
  'this column. Note that the key names the slot, not the hue: ''green'' '
  'resolves to a teal, having been replaced when the original green failed '
  'AA. Palette values are WCAG 2.2 AA-tuned; see '
  'docs/design_handoff_admin_dashboard/README.md.';
