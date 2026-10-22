-- N16: allow 'availability_confirm' as an sms_usage kind.
--
-- The confirmation SMS an official gets when they confirm availability is a
-- fifth sender. sms_usage.kind is a CHECK rather than an enum precisely so
-- this is a one-line change (see 20261019093632_sms_usage_accounting.sql),
-- but the constraint still has to be dropped and recreated to widen it.
--
-- Not gated by the N24 cost cap, deliberately: the send is triggered by the
-- recipient, and "you have reached your limit" is not a sentence the
-- recipient can act on. It is still measured here like every other send.
--
-- Forward-fix: replace
--   Rollback: restore the constraint definition from migration
--             20261019093632_sms_usage_accounting.sql — i.e. drop this
--             constraint and recreate it without 'availability_confirm'.
--             That fails while any such row exists; delete those rows first
--             (they are accounting history, not application state).
--   Data:     no data loss — widening a CHECK rewrites no rows.
--   Blast:    nothing, until code writes the new kind. Deployed before the
--             image that uses it, a stale image simply never writes it.
--   Window:   compatible. The currently deployed code writes only the four
--             existing kinds, and a widened CHECK accepts every one of them.

alter table public.sms_usage
  drop constraint if exists sms_usage_kind_check;

alter table public.sms_usage
  add constraint sms_usage_kind_check
  check (kind in ('invite', 'invite_resend', 'announcement', 'gdpr_warning', 'availability_confirm'));
