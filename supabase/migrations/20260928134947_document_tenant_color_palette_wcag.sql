-- ============================================================================
-- Migration: document tenant.color_palette as a key into the WCAG palette set
-- ============================================================================
--
-- Part of the admin-dashboard color update
-- (docs/design_handoff_admin_dashboard/). That round re-themed the UI so every
-- theme color clears WCAG 2.2 AA: text at 4.5:1 against white, UI borders at
-- 3:1. Most colors were re-tuned in lightness with the hue preserved; the
-- 'green' key is the exception — its old primary and accent sat at 2.42:1 and
-- 2.77:1, too far under to fix by lightness alone, so it was replaced with a
-- teal (#0E7490 / #334155 / #0369A1, at 5.36:1, 10.35:1 and 5.93:1). The key
-- is still spelled 'green' because it is a stored value; see below.
--
-- Deliberately, this migration changes no data and no constraint.
--
-- What changed was the *hex values behind* each palette key, not the keys
-- themselves — including for 'green', where the key now resolves to a teal.
-- Renaming that key would mean rewriting stored rows in every environment for
-- a cosmetic gain, so the name is deliberately left as it is.
--
-- Those values live in src/lib/theme/tenant-colors.ts and are emitted as CSS
-- custom properties at request time by TenantThemeStyle — they have never
-- been stored in Postgres. The set of legal keys is still exactly
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
  'TenantThemeStyle. Do not store color values in this column. Note that the '
  'key names the slot, not the hue: ''green'' currently resolves to a teal, '
  'having been replaced when the original green failed AA. Palette values are '
  'WCAG 2.2 AA-tuned; see docs/design_handoff_admin_dashboard/README.md.';
