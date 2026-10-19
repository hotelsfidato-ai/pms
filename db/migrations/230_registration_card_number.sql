-- =============================================================================
-- 230 · The guest registration card's number (the owner's D27-344, 19 October;
--       D27-345: it starts at 1, and only a check-in from now on gets one)
-- =============================================================================
-- `reservations.gr_card_no`: a running number per hotel, given when the stay
-- is checked in, printed on the registration card and the tax invoice. Given
-- once: a stay checked in again keeps its number.
--
-- The next number is the hotel's highest plus one, under a lock per hotel, so
-- two check-ins at once never share one (the unique index is the backstop).
-- No series table: a test hotel's reset clears its stays, and its numbers
-- start again at 1 as its invoice series does (212).
--
-- Re-runnable.
-- =============================================================================

alter table reservations add column if not exists gr_card_no integer;
comment on column reservations.gr_card_no is
  'D27-344: the guest registration card''s number, a running number per hotel given at check-in.';

create unique index if not exists reservations_gr_card_no_key
  on reservations (hotel_id, gr_card_no) where gr_card_no is not null;

-- SECURITY DEFINER: the clerk checking a guest in may not see every stay of
-- the hotel (a test hotel's, say), and the highest number must count them all.
create or replace function app.give_gr_card_no()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'checked_in' and new.gr_card_no is null
     and (tg_op = 'INSERT' or old.status is distinct from 'checked_in') then
    perform pg_advisory_xact_lock(hashtextextended('gr_card_no:' || new.hotel_id::text, 0));
    select coalesce(max(gr_card_no), 0) + 1 into new.gr_card_no
      from reservations where hotel_id = new.hotel_id;
  end if;
  return new;
end
$$;

drop trigger if exists reservations_gr_card_no on reservations;
create trigger reservations_gr_card_no
  before insert or update of status on reservations
  for each row execute function app.give_gr_card_no();
