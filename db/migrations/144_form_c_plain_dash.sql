-- =============================================================================
-- 144 · The Form C register's missing room is a plain "-" (GUE-2, D27-1)
-- =============================================================================
-- 025's app.form_c_due wrote a long dash for a stay with no room, and the
-- screen printed it: "GB · room —". The long dash is banned in anything a
-- person reads (D17-48). Same function, same signature and return type
-- (MEMORY 317); only the room's placeholder changes.
-- =============================================================================

create or replace function app.form_c_due(p_hotel_id uuid)
returns table (
  reservation_id uuid,
  guest_name     text,
  nationality    text,
  passport       text,
  room_number    text,
  arrived        date,
  due_by         timestamptz,
  overdue        boolean,
  filed          boolean,
  reference      text
)
language sql
stable
as $fn$
  select r.id,
         g.full_name,
         g.nationality,
         -- Passport from guest_documents, LEFT JOINed: a foreign national with
         -- no document row still owes a filing (see 025).
         gd.id_number,
         coalesce(rm.number, '-'),
         r.check_in,
         -- 24 hours from the check-in date (see 025).
         (r.check_in + 1)::timestamptz,
         (r.check_in + 1)::timestamptz < now() and f.id is null,
         f.id is not null,
         f.reference
    from reservations r
    join guests g on g.id = r.guest_id
    left join guest_documents gd on gd.guest_id = g.id
    left join room_assignments ra on ra.reservation_id = r.id
                                 and ra.released_at is null
    left join rooms rm on rm.id = ra.room_id
    left join form_c_filings f on f.reservation_id = r.id
   where r.hotel_id = p_hotel_id
     and g.nationality <> 'IN'
     and r.status in ('checked_in', 'checked_out')
   order by r.check_in desc
$fn$;

comment on function app.form_c_due(uuid) is
  'Foreign nationals who have stayed, whether their Form C has been filed, and '
  'whether the 24-hour deadline has passed. The obligation is the hotel''s; '
  'this only makes it visible.';
