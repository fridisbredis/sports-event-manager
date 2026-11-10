-- ============================================================================
-- Migration 20261110120000: events.claim_token — the hard-to-guess key of an
-- event's open claim list (N39, Participant 5/10, L9, L10, PB6)
-- ============================================================================
--
-- CLAIM-01 is a public page: a runner opens it from a link or a printed QR
-- code, without signing in, and finds their own row by bib or name. The URL
-- must therefore identify exactly one event, and must not be guessable from
-- anything else — otherwise the page becomes a way to list every event's
-- start list, in every tenant.
--
-- WHY A TOKEN, NOT A SLUG OR THE EVENT ID ("OPEN FOR FRIDA" on the card):
--   - A slug (tenant + event name) is guessable by design; that is what a
--     slug is for.
--   - events.id is a UUID too, but it is not a secret: it is in every admin
--     and official URL (/events/<eventId>/...), in screenshots, in support
--     messages. Making it double as a public key would turn every one of
--     those into a claim link.
--   - A separate random value can be kept only for this one purpose. Same
--     shape as officials.invite_token (0010): gen_random_uuid(), 122 random
--     bits.
--
-- The token NEVER CHANGES (card: "the link never changes, so printed QR
-- codes keep working"). Whether the page is open is decided at request time
-- from the event's status and the tenant's tier (isParticipantSideOpen,
-- src/lib/events/participant-side.ts), never by issuing or revoking tokens.
-- There is no rotation function; a leaked link exposes bib and name of one
-- event while that event is published, which the organiser publishes anyway.
--
-- create_event copies an event (N38 note) with an explicit column list that
-- does not name claim_token, so a copy gets its own token from the default.
--
-- Reading the column: events RLS is unchanged. Tenant admins and the event's
-- officials and participants can read it — all people the organiser would
-- hand the link to anyway. The public page reads it with the service role
-- (ADR-0001, category 2: public token-gated flow).
--
-- Forward-fix: additive
--   Rollback: alter table public.events drop column if exists claim_token;
--             Every printed QR code and shared link stops resolving, and a
--             re-add mints new tokens — so roll back only before any link
--             has been handed out.
--   Data:     no data loss. ADD COLUMN with a volatile default gives every
--             existing event its own distinct token in the same statement.
--   Blast:    if the column is missing, CLAIM-01 shows "not available" for
--             every link and PART-01 cannot render its claim link.
--   Window:   compatible. Deployed code never selects events.* into a typed
--             shape that rejects an extra column, and no insert names it.
-- ============================================================================

alter table public.events
  add column if not exists claim_token uuid not null default gen_random_uuid();

-- The lookup key of the public page, and a guarantee that no two events can
-- ever answer the same link.
create unique index if not exists events_claim_token_key
  on public.events (claim_token);

comment on column public.events.claim_token is
  'N39: the random, never-changing key of the event''s public claim list '
  '(/claim/<claim_token>). Not a credential for anything else. Whether the '
  'list is open is decided by status + tier at request time.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select count(*), count(distinct claim_token) from public.events;
--   -- both numbers equal
--   select indexname from pg_indexes where indexname = 'events_claim_token_key';
--   -- one row
-- ============================================================================
