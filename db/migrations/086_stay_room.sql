-- =============================================================================
-- 086 · Which room a stay was in, answered once
-- =============================================================================
-- A departed group room read "Room —" on the stay panel's group list.
-- `app.group_rooms()` (071) chose the room with
--
--     where ra.released_at is null
--
-- and a check-out RELEASES the room, so every departed stay had none. The
-- demo's Pancham Hall function, measured on 14 September: three rooms, all
-- checked out, all "(none)" — while their own references end in -302, -303
-- and -305.
--
-- ⚠ THIS WAS ALREADY FOUND AND FIXED ONCE, IN ONE PLACE. `stays.ts` carries
-- the comment: "Filtering to released_at is null was wrong: a check-out
-- releases the room, so 60 of the 83 stays came back with no room number".
-- It was fixed there, by preferring the assignment still held and then the
-- most recent — and the same rule was then written out again by hand in six
-- more queries, while three others kept the old one. A rule in ten places is
-- wrong in some of them; that is this project's most expensive shape.
--
-- So the rule is a function now, and the three displays that had it wrong
-- call it: this list, the group's master bill lines, and the billing screen's
-- refunds-due list. Queries that ask "who is in this room RIGHT NOW" — check
-- out, room status, pre-arrival assignment — want the held assignment only,
-- and correctly keep `released_at is null`. They are a different question.
-- =============================================================================

create or replace function app.stay_room(p_reservation uuid)
returns text
language sql stable as $$
  /* The room still held wins; otherwise the latest one they were in. That
     also answers a room MOVE: two assignments, and the current one wins —
     or, after check-out, the one they left from. */
  select rm.number
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
   order by ra.released_at nulls first, ra.from_date desc
   limit 1;
$$;

comment on function app.stay_room(uuid) is
  'The room a stay is in, or was in: the assignment still held, else the '
  'most recent. NULL only when no room was ever assigned. For DISPLAY — '
  '"who is in this room now" is a different question and wants the held '
  'assignment alone.';

grant execute on function app.stay_room(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- The group's rooms — 071's function, with the room asked of app.stay_room
-- -----------------------------------------------------------------------------
-- Same signature and same return type, so CREATE OR REPLACE is enough, and a
-- second run replaces it with itself.
create or replace function app.group_rooms(p_hotel uuid, p_group uuid)
returns table (
  reservation_id uuid,
  reference      text,
  guest          text,
  room           text,
  room_type      text,
  check_in       date,
  check_out      date,
  nights         int,
  status         text,
  agreed_rate    numeric,
  routed         boolean,
  balance        numeric,     -- on the stay's OWN folio, not the master
  adults         int,
  children       int
)
language sql stable as $$
  select
    r.id, r.reference, g.full_name,
    app.stay_room(r.id),
    rt.name, r.check_in, r.check_out, (r.check_out - r.check_in)::int,
    r.status, r.agreed_rate, r.route_room_to_group,
    coalesce((
      select sum(fp.amount + fp.tax_amount)
        from folios f
        join folio_postings fp on fp.folio_id = f.id
       where f.reservation_id = r.id
    ), 0),
    r.adults, r.children
  from reservations r
  join guests g      on g.id  = r.guest_id
  join room_types rt on rt.id = r.room_type_id
 where r.hotel_id = p_hotel
   and r.group_id = p_group
   -- A void booking never happened, so it is not one of the group's rooms.
   and r.status <> 'void'
 order by rt.sort_order, rt.name, r.reference
$$;

comment on function app.group_rooms(uuid, uuid) is
  'The rooms in a group with each stay''s own balance and party size. The '
  'master folio''s balance is asked for separately — adding them into one '
  'number would hide which of the two somebody is being asked to pay. '
  'Ordered by room TYPE, because that is how a group reads: two Superior '
  'and one Deluxe, not three rows in reference order. The room is '
  'app.stay_room(), so a departed stay still says where it stayed (086).';

grant execute on function app.group_rooms(uuid, uuid) to pms_app;
