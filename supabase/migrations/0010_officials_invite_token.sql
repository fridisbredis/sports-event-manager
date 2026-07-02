-- 0010_add_officials_invite_token.sql
-- Add secure invite token to officials for AUTH-02 invite confirmation flow

ALTER TABLE officials
  ADD COLUMN invite_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN invite_token_expires_at timestamptz;

ALTER TABLE officials
  ADD CONSTRAINT officials_invite_token_unique UNIQUE (invite_token);

-- NOTE: existing rows get a fresh random token via the column default, but
-- anyone currently in 'invited' status was texted the OLD link (no token).
-- Their new token won't match what's in that old SMS — resend their invite
-- after this migration so they get a link that actually works.
--
-- NOTE: invite_token_expires_at has no default and stays NULL until the
-- API/resend routes are updated to set it explicitly (e.g. now() + interval
-- '7 days') on insert and on resend. Until that's wired up, links won't expire.
