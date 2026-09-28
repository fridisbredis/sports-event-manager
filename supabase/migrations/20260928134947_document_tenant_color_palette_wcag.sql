-- ============================================================================
-- Migration: document tenant.color_palette as a key into the WCAG palette set
-- ============================================================================
--
-- Part of the admin-dashboard color update
-- (docs/design_handoff_admin_dashboard/). That round re-themed the UI with a
-- WCAG 2.2 AA-compliant Blue/Green/Orange system: every theme color was
-- re-tuned in lightness (hue preserved) so text clears 4.5:1 against white and
-- UI borders clear 3:1.
--
-- Deliberately, this migration changes no data and no constraint.
--
-- What changed was the *hex values behind* each palette key, not the keys
-- themselves. Those values live in src/lib/theme/tenant-colors.ts and are
-- emitted as CSS custom properties at request time by TenantThemeStyle — they
-- have never been stored in Postgres. The set of legal keys is still exactly
-- ('blue', 'green', 'orange'), so the CHECK added by migration 0016 is still
-- correct as written and is left untouched.
--
-- The column comment is the point: it stops the next person from reading a
-- bare `text` column named `color_palette` as somewhere a hex value belongs,
-- and points them at the file that actually defines the palette. The handoff
-- also introduced a per-theme token set (hover/tint/tint-text) rather than a
-- single color per key; that too is a code-side shape, invisible from here.
--
-- Verified before writing, on both environments:
--   dev  (lhflutwvwvzawzbcuwup): blue 4, green 2, orange 1
--   prod (rauvaxuypujbeintnnoe): blue 4, green 1
-- Every row is already inside the CHECK, so no backfill is required. The
-- value 'default' appears in some test fixtures but in no database; code
-- tolerates it anyway — TenantThemeStyle falls back to DEFAULT_TENANT_PALETTE
-- for any unrecognized key rather than throwing.
--
-- Forward-fix: additive
--   Rollback: `COMMENT ON COLUMN public.tenants.color_palette IS NULL;`
--             Nothing else to undo.
--   Data:     none touched. No DML, no DDL beyond a comment.
--   Blast:    none. A column comment is metadata; it is not read by the
--             application, by PostgREST's schema cache in any behavioral way,
--             or by RLS.
--   Window:   compatible in both directions. Old and new app builds run
--             against this schema unchanged; the new colors ship with the app
--             deploy, not with this migration.
-- ============================================================================

COMMENT ON COLUMN public.tenants.color_palette IS
  'Key into TENANT_PALETTES in src/lib/theme/tenant-colors.ts — one of blue, '
  'green, orange (enforced by the CHECK from migration 0016). Stores the key '
  'only: the hex/HSL values for each theme, including the hover and tint '
  'tokens, live in that file and are emitted as CSS custom properties by '
  'TenantThemeStyle. Do not store color values in this column. Palette values '
  'are WCAG 2.2 AA-tuned; see docs/design_handoff_admin_dashboard/README.md.';
