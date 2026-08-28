-- =============================================================================
-- 001_foundation.sql — extensions, helpers, conventions
-- =============================================================================
-- Run these migrations IN ORDER. Each one is idempotent enough to re-run during
-- development, but in production you run each exactly once, in sequence.
--
-- WHY A SEPARATE `app` SCHEMA:
--   Keeping our helper functions out of `public` means they never collide with
--   a table name, and `public` stays readable as "the actual data model".
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text, for email

create schema if not exists app;


-- -----------------------------------------------------------------------------
-- app.current_user_id() — who is asking?
-- -----------------------------------------------------------------------------
-- Every RLS policy needs to know the signed-in user. Where that comes from
-- differs by host, so this function papers over the difference and everything
-- else in the schema calls THIS, never the host-specific thing.
--
--   Supabase          → the JWT claim `sub`, same value as auth.uid()
--   Self-hosted       → PostgREST sets request.jwt.claim.sub the same way
--   Scripts / cron    → SET LOCAL app.user_id = '<uuid>';
--
-- Writing it this way now is what lets you move between Supabase and your own
-- Oracle box later without touching a single policy.
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('app.user_id', true), '')
  )::uuid
$$;


-- -----------------------------------------------------------------------------
-- app.touch_updated_at() — keep updated_at honest
-- -----------------------------------------------------------------------------
-- Attached as a BEFORE UPDATE trigger on tables that carry updated_at.
-- Doing it in the database means it is true even when a migration, a script or
-- psql does the update — application code cannot forget.
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;


-- -----------------------------------------------------------------------------
-- app.forbid_mutation() — make a table append-only
-- -----------------------------------------------------------------------------
-- Used on the folio ledger in 006. A charge is never edited or deleted; it is
-- reversed by posting an opposite line. This trigger makes that a guarantee of
-- the database rather than a rule people remember.
-- -----------------------------------------------------------------------------
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    '% is append-only. Post a reversing entry instead of % on row %.',
    tg_table_name, tg_op, coalesce(old.id::text, '?')
    using hint = 'Insert a negative/reversing posting that references the original.';
end
$$;

