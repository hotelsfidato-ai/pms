-- =============================================================================
-- 089 · "Start here" — a person's first jobs, until they say they have them
-- =============================================================================
-- The clarity plan's step 4 (15 September). A new receptionist sees a card
-- of the five things they will do most, each a link; a housekeeper sees
-- theirs, a waiter theirs, a chef theirs. The owner's decisions:
--
--   · a card per role (general manager and owner get none)
--   · it goes when they tap "Got it" — not after a count of sign-ins, which
--     could hide it before anybody read it — and they can bring it back
--     from the account menu
--   · remembered per person on the server, like the first screen (087), so
--     it follows them to whichever terminal they sign in at
--
-- One boolean. What the card SAYS lives in the interface, per role; the
-- database remembers only whether this person has put it away.
-- =============================================================================

alter table staff add column if not exists start_here_dismissed boolean not null default false;

comment on column staff.start_here_dismissed is
  'True once the person tapped "Got it" on their Start here card. They can '
  'set it back from the account menu. Their own choice, set only by them.';

-- Read and write the caller's OWN row, and nothing else — the same shape as
-- app.set_my_preferences (087). There is no "set it for somebody else": a
-- card of first jobs is the person's, and a manager has no reason to hide
-- or show it for them.
create or replace function app.my_start_here_dismissed()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select start_here_dismissed from staff where id = app.current_user_id()),
    false);
$$;

create or replace function app.set_start_here(p_dismissed boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.current_user_id() is null then
    raise exception 'Nobody is signed in.' using errcode = '42501';
  end if;
  if p_dismissed is null then
    raise exception 'Put the card away, or bring it back.' using errcode = '22023';
  end if;
  update staff set start_here_dismissed = p_dismissed
   where id = app.current_user_id();
end $$;

grant execute on function app.my_start_here_dismissed() to pms_app;
grant execute on function app.set_start_here(boolean) to pms_app;
