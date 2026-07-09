-- Migration 0016: add color_palette to tenants
-- Lets each tenant pick one of the predefined color palettes
-- (see src/lib/theme/tenant-colors.ts) used to theme HeroUI components.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS color_palette text NOT NULL DEFAULT 'blue'
    CHECK (color_palette IN ('blue', 'green', 'orange'));
