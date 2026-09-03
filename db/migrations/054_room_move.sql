-- =============================================================================
-- 054 — moving a guest between rooms
-- =============================================================================
-- A guest in 203 moves to 305 on night three. `room_assignments` already
-- models this: it is keyed by DATE RANGE, not by reservation, and it carries
-- `released_at` and a `reason` that already lists move, upgrade, downgrade and
-- fault. Nothing needed adding to express it. What was missing was the act.
--
--   before   203 ├──────── 1st to 6th ────────┤
--   after    203 ├── 1st–3rd ──┤
--            305               ├── 3rd–6th ───┤
--
-- WHAT THIS DOES NOT TOUCH IS THE MONEY, and that is not an omission.
--
-- The night audit posts `reservations.agreed_rate` — snapshotted at booking,
-- and explicitly never looked up again, so that a rate plan changing in June
-- cannot silently reprice a booking made in March. A move therefore changes no
-- charge by itself, in either direction.
--
-- NIGHTS ALREADY POSTED ARE NEVER REWRITTEN. The guest genuinely slept in 203
-- for two nights; the ledger is append-only, and a posting reversed and
-- re-made because of something that happened afterwards is history being
-- edited. If a manager decides those nights should be cheaper — the air
-- conditioning failed, and that is why the guest moved — that is an explicit
-- adjustment with a reason on the folio, which already exists and which
-- somebody can be asked about later.
--
-- WHAT CAN CHANGE IS THE RATE FROM THE MOVE DATE ONWARD, when the room type
-- differs. That is `agreed_rate`, it is the caller's decision rather than this
-- function's, and because the audit posts one night at a time it only ever
-- reaches nights not yet charged.
-- =============================================================================

create or replace function app.move_room(
  p_hotel       uuid,
  p_reservation uuid,
  p_room        uuid,
  p_from        date,     -- first night in the NEW room
  p_reason      text,
  p_by          uuid
)
returns table (
  left_room      text,
  nights_before  int,     -- nights kept in the room being left
  nights_after   int      -- nights in the new room
)
language plpgsql
as $$
declare
  a          record;
  v_check_in  date;
  v_check_out date;
  v_old_room  text;
begin
  select r.check_in, r.check_out into v_check_in, v_check_out
    from reservations r
   where r.id = p_reservation and r.hotel_id = p_hotel;

  if v_check_in is null then
    raise exception 'no such reservation here';
  end if;

  /* THE DATE IS CHECKED FIRST, and the order matters. A date past check-out
     has no assignment covering it, so looking for one first answers "this
     booking is not in a room on the 20th" — true, useless, and sends a clerk
     to the wrong screen. "That is outside the stay" is the thing they can
     act on. Say the most actionable true thing, not the first one found. */
  if p_from < v_check_in or p_from >= v_check_out then
    raise exception 'the move date is outside the stay (% to %)',
      v_check_in, v_check_out
      using hint = 'The night of departure belongs to nobody, so the last '
                   'night a guest can be moved is the one before check-out.';
  end if;

  /* The live assignment. A stay can have several rows once it has been moved
     before, so this is the one that has not been released and that covers the
     move date — not simply the first. */
  select ra.*, rm.number as room_number into a
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
     and ra.released_at is null
     and p_from < ra.to_date
   order by ra.from_date desc
   limit 1;

  if a.id is null then
    raise exception 'this booking is not in a room on %', p_from
      using hint = 'Assign a room first.';
  end if;

  if a.room_id = p_room then
    raise exception 'that is the room they are already in'
      using hint = 'Pick a different room, or leave the booking alone.';
  end if;

  v_old_room := a.room_number;

  if p_from <= a.from_date then
    /* Moving from the first night this assignment covers: the guest never
       spent a night in it, so it is released whole rather than left as a
       zero-length row. `ra_dates_ordered` would refuse to_date = from_date
       anyway, which is the constraint doing its job. */
    update room_assignments set released_at = now() where id = a.id;
  else
    /* Shrinking a range can never create an overlap, so the exclusion
       constraint is safe here and the room is freed from the move date on. */
    update room_assignments set to_date = p_from where id = a.id;
  end if;

  insert into room_assignments
    (hotel_id, reservation_id, room_id, from_date, to_date, reason, created_by)
  values (p_hotel, p_reservation, p_room, p_from, v_check_out, p_reason, p_by);

  return query select
    v_old_room,
    greatest(p_from - a.from_date, 0)::int,
    (v_check_out - p_from)::int;
end $$;

comment on function app.move_room is
  'Splits a room assignment at a date: the room being left keeps the nights '
  'up to it, the new room takes the rest. Touches no posting — the audit '
  'charges reservations.agreed_rate, and nights already posted are history.';

revoke all on function app.move_room(uuid, uuid, uuid, date, text, uuid) from public;
grant execute on function app.move_room(uuid, uuid, uuid, date, text, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Taking a guest out of a room without putting them in another
-- -----------------------------------------------------------------------------
-- The room was assigned in error, or the booking is being held unassigned
-- until the guest arrives. Releasing is not deleting: the row stays, so the
-- question "who was in 203 last Tuesday" still has an answer.
-- -----------------------------------------------------------------------------
create or replace function app.unassign_room(
  p_hotel uuid, p_reservation uuid
)
returns text                       -- the room they were taken out of
language plpgsql
as $$
declare v_room text;
begin
  select rm.number into v_room
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
     and ra.hotel_id = p_hotel
     and ra.released_at is null
   limit 1;

  if v_room is null then
    raise exception 'this booking is not in a room';
  end if;

  update room_assignments
     set released_at = now()
   where reservation_id = p_reservation
     and hotel_id = p_hotel
     and released_at is null;

  return v_room;
end $$;

comment on function app.unassign_room(uuid, uuid) is
  'Releases every live assignment for a booking. The rows stay — releasing is '
  'not deleting, and "who was in 203 last Tuesday" must keep an answer.';

revoke all on function app.unassign_room(uuid, uuid) from public;
grant execute on function app.unassign_room(uuid, uuid) to pms_app;
