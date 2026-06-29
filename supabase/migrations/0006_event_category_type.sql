-- Migration 0006: add category_type to events
-- Allows events to be configured as distance-based or time-based.
-- UI toggle on EVT-02 switches labels/placeholders; value stored here.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS category_type text NOT NULL DEFAULT 'distance'
    CHECK (category_type IN ('distance', 'time'));
