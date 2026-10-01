-- =============================================================================
-- 176 — a day use can be amended (the owner's D27-229, 1 October)
-- =============================================================================
-- New booking makes a day use since D27-227: check-out = check-in, is_day_use
-- (015), its typed day price charged at check-in (D27-225). app.amend_stay
-- (055) refused check-out <= check-in, so Change dates or guests on a day use
-- - even its adults - was refused "a stay ends after it starts".
--
-- 055's function with three changes, nothing else:
--   · only a departure BEFORE the arrival is refused;
--   · a day use's own day, charged at its check-in, does not count as a night
--     charged after its departure;
--   · a day use's hold, which starts and ends on its day, is not released.
-- The rate is still not touched (agreed_rate is the typed day price). Same
-- signature, create or replace, so it replays.
-- =============================================================================

create or replace function app.amend_stay(
  p_hotel       uuid,
  p_reservation uuid,
  p_check_in    date,
  p_check_out   date,
  p_adults      smallint,
  p_children    smallint,
  p_by          uuid
)
returns table (
  nights_before int,
  nights_after  int,
  room_held     text        -- the room whose hold was resized, or NULL
)
language plpgsql
as $$
declare
  r          record;
  a          record;
  v_last_posted date;
  v_max_occ  int;
  v_room     text := null;
begin
  select res.*, rt.max_occupancy into r
    from reservations res
    join room_types rt on rt.id = res.room_type_id
   where res.id = p_reservation and res.hotel_id = p_hotel;

  if r.id is null then
    raise exception 'no such reservation here';
  end if;

  if r.status not in ('confirmed', 'checked_in') then
    raise exception 'this booking is %, so there is nothing to amend', r.status
      using hint = 'A booking that has left or been cancelled is history.';
  end if;

  /* A DAY USE ends the day it starts (D27-227): only a departure BEFORE the
     arrival is refused. */
  if p_check_out < p_check_in then
    raise exception 'a stay ends after it starts'
      using hint = 'The night of departure is not charged, so a guest leaving '
                   'on the 5th has their last night on the 4th.';
  end if;

  -- ---- 3 · they have already arrived ----------------------------------
  if r.status = 'checked_in' and p_check_in <> r.check_in then
    raise exception 'they arrived on %, and that cannot move', r.check_in
      using hint = 'Change the departure instead.';
  end if;

  -- ---- occupancy -------------------------------------------------------
  v_max_occ := r.max_occupancy;
  if p_adults < 1 then
    raise exception 'a stay has at least one adult';
  end if;
  if p_adults + p_children > v_max_occ then
    raise exception '% people will not fit a % - it sleeps %',
      p_adults + p_children, (select name from room_types where id = r.room_type_id),
      v_max_occ
      using hint = 'Move them to a larger room type, or split across two rooms.';
  end if;

  -- ---- 2 · nights already charged --------------------------------------
  /* A LIVE room charge. There is no `reversed` flag — a reversal is its own
     row pointing back with `reverses_id`, because the ledger is append-only
     and a posting is never edited. So a charge still stands only if it is not
     itself a reversal and nothing has reversed it. */
  select max(fp.business_date) into v_last_posted
    from folio_postings fp
    join folios f on f.id = fp.folio_id
   where f.reservation_id = p_reservation
     and fp.category = 'room'
     and fp.reverses_id is null
     and not exists (
       select 1 from folio_postings x where x.reverses_id = fp.id);

  if v_last_posted is not null then
    /* A room charge dated D pays for the night of D, so the stay must still
       cover D — that is, check_out must be after it. */
    /* A day use's own day, charged at its check-in (D27-225), is inside it. */
    if p_check_out <= v_last_posted
       and not (p_check_out = p_check_in and v_last_posted = p_check_in) then
      raise exception 'the night of % has already been charged', v_last_posted
        using hint = 'Reverse that posting first if the guest is not staying '
                     'it, so the folio says why rather than simply losing a '
                     'night.';
    end if;
    if p_check_in > v_last_posted then
      raise exception 'the night of % has already been charged', v_last_posted
        using hint = 'Moving arrival past a charged night would leave a room '
                     'charge outside the stay.';
    end if;
  end if;

  -- ---- the booking moves FIRST ------------------------------------------
  /* Order matters, and not for style. A trigger keeps every assignment inside
     its reservation's dates, so resizing the hold before the booking raises
     "assignment 10th..16th falls outside the booking 10th..14th" — refusing
     the very thing being asked for. The booking moves, then the hold follows.

     If the hold then collides, the whole function rolls back: the caller made
     one statement, so a refused extension leaves the booking exactly as it
     was. */
  update reservations
     set check_in  = p_check_in,
         check_out = p_check_out,
         adults    = p_adults,
         children  = p_children
   where id = p_reservation;

  -- ---- 1 · and the room hold follows it ---------------------------------
  select ra.id, rm.number into a
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
     and ra.released_at is null
   order by ra.from_date
   limit 1;

  if a.id is not null then
    v_room := a.number;
    /* Resized rather than left behind. The exclusion constraint refuses this
       if the room is taken for the nights being added, which is the whole
       point — the alternative is a booking that claims six nights while the
       room is held for four. */
    update room_assignments
       set from_date = greatest(p_check_in, least(from_date, p_check_out - 1)),
           to_date   = p_check_out
     where id = a.id;

    /* Any LATER assignment — the stay has been moved before — is clipped to
       the new departure too, and dropped if it now starts after it. */
    update room_assignments
       set to_date = p_check_out
     where reservation_id = p_reservation
       and released_at is null
       and to_date > p_check_out
       and from_date < p_check_out;

    update room_assignments
       set released_at = now()
     where reservation_id = p_reservation
       and released_at is null
       and from_date >= p_check_out
       -- A day use's hold starts and ends on its day (015): it stays.
       and from_date > p_check_in;
  end if;

  nights_before := (r.check_out - r.check_in)::int;
  nights_after  := (p_check_out - p_check_in)::int;
  room_held     := v_room;

  return next;
end $$;

comment on function app.amend_stay is
  'Changes a booking''s dates and party size, resizing the room hold with it; '
  'a day use (out the day it comes) is a stay too (176). '
  'Refuses a departure before a night already charged, a moved arrival on a '
  'guest who has arrived, and a party larger than the room type sleeps. Does '
  'not touch agreed_rate — added nights are charged at the rate agreed.';

revoke all on function app.amend_stay(uuid, uuid, date, date, smallint, smallint, uuid)
  from public;
grant execute on function app.amend_stay(uuid, uuid, date, date, smallint, smallint, uuid)
  to pms_app;
