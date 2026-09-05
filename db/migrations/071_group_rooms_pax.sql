-- =============================================================================
-- 071_group_rooms_pax.sql — how many people are in each of a group's rooms
-- =============================================================================
-- `app.group_rooms()` returned the room, the rate and the balance, and not how
-- many people were in it. For a group that is the first thing anybody asks:
-- nine rooms for a wedding is meaningless until you know whether it is nine
-- couples or nine families, and it is what housekeeping sets the beds from.
--
-- The columns have been on `reservations` since 004. They were simply never
-- carried out of this function, so every screen built on it had to go back to
-- the reservation for a number that was one join away.
--
-- DROPPED AND RECREATED, not replaced: a function's return type cannot be
-- changed by CREATE OR REPLACE, and `drop function if exists` is what makes
-- this survive being applied twice.
-- =============================================================================

drop function if exists app.group_rooms(uuid, uuid);

create function app.group_rooms(p_hotel uuid, p_group uuid)
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
    (select rm.number from room_assignments ra
       join rooms rm on rm.id = ra.room_id
      where ra.reservation_id = r.id and ra.released_at is null
      order by ra.from_date limit 1),
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
  'and one Deluxe, not three rows in reference order.';

grant execute on function app.group_rooms(uuid, uuid) to pms_app;
