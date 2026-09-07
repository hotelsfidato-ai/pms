-- =============================================================================
-- 072 · The room a stay is in TONIGHT — one row, not one per room it has used
-- =============================================================================
-- A room move does not release anything. Migration 054 models it as two LIVE
-- assignments over adjoining half-open ranges — the old room up to the move,
-- the new room from it — because both are true, on different nights.
--
-- Every reader that asks "which room is this stay in" by writing
--
--     join room_assignments ra on ra.reservation_id = r.id
--                             and ra.released_at is null
--
-- with no date therefore gets ONE ROW PER SEGMENT for a moved stay. It has
-- been wrong since 054 shipped and nothing caught it, because the only moved
-- stay anybody had was complimentary.
--
-- Two readers were affected. The night audit was the expensive one: it posted
-- the night's tariff once per row, so a moved guest was charged twice a night
-- for the rest of their stay. That is fixed in api/src/routes/nightAudit.ts,
-- with a guard in api/test/nightAudit.test.ts proved in both directions.
--
-- This file fixes the other one. `app.pos_chargeable_rooms` is the waiter's
-- "charge it to a room" list AND the API's own refusal — the comment on it
-- says so, which is exactly why it matters that the two agree. At Akkalkot it
-- listed the same guest twice, in 302 and 303, and a waiter has no way to know
-- which of two identical names is the right one. The charge would have landed
-- on the same folio either way, so no money was lost here; a waiter picking
-- between two identical rows is still the kind of thing that makes somebody
-- stop trusting a screen.
--
-- THE PREDICATE IS THE HALF-OPEN RANGE this schema uses everywhere:
-- `from <= D < to`. Written once, here, so the next reader can call it rather
-- than writing a third copy of a join that has now been wrong twice.
-- =============================================================================

-- The room a stay occupies on a given date, or null if none. One row, always.
create or replace function app.room_on(p_reservation uuid, p_on date)
returns text
language sql
stable
as $fn$
  select rm.number
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
     and ra.released_at is null
     and ra.from_date <= p_on
     and (ra.to_date is null or ra.to_date > p_on)
   order by ra.from_date desc
   limit 1
$fn$;

comment on function app.room_on(uuid, date) is
  'The room a stay is in ON a date -- the night that date charges for. A '
  'moved stay has several live assignments over adjoining half-open ranges; '
  'released_at is null is true of all of them, so it is not the question.';

-- -----------------------------------------------------------------------------
-- The room to SHOW for a stay, which is a different question from the one
-- above and the difference is a departure morning.
--
-- ⚠ THE FIRST VERSION OF THIS FILE USED room_on ALONE AND THE SUITE CAUGHT IT.
-- An assignment runs [check_in, check_out) because that is the set of NIGHTS
-- sold. On the morning a guest leaves, the business date has reached
-- check_out, room_on returns null -- correctly, nobody is buying that night --
-- and the guest disappeared from the waiter's charge-to-room list while still
-- sitting at breakfast in the room. Trading a duplicate row for a missing one
-- is not a fix.
--
-- So: the room for that date if there is one, and otherwise the last room they
-- were live in. Never null while any live assignment exists, and never more
-- than one.
-- -----------------------------------------------------------------------------
create or replace function app.room_for(p_reservation uuid, p_on date)
returns text
language sql
stable
as $fn$
  select coalesce(
    app.room_on(p_reservation, p_on),
    (select rm.number
       from room_assignments ra
       join rooms rm on rm.id = ra.room_id
      where ra.reservation_id = p_reservation
        and ra.released_at is null
      order by ra.from_date desc
      limit 1)
  )
$fn$;

comment on function app.room_for(uuid, date) is
  'The room to show for a stay as of a date: the room that date is charged '
  'for, else the last one still live. One answer, and not null while the stay '
  'holds a room -- including the morning it checks out.';

-- -----------------------------------------------------------------------------
-- The waiter list, de-duplicated by asking the right question.
--
-- Returns the same columns and the same SET of stays as before -- one row per
-- checked-in stay with an open folio and a room -- minus the duplicates a
-- moved stay produced. The date is the property's own business date rather
-- than now(): a restaurant serving past midnight is still working the night
-- the desk has not closed, and a waiter should not watch the room list change
-- under them at 00:01.
-- -----------------------------------------------------------------------------
create or replace function app.pos_chargeable_rooms(p_hotel_id uuid)
returns table (
  room_number text,
  guest_name  text,
  folio_id    uuid,
  balance     numeric
)
language sql
stable
as $fn$
  select app.room_for(r.id, app.business_date(p_hotel_id)),
         g.full_name,
         f.id,
         coalesce((select sum(fp.amount) from folio_postings fp
                    where fp.folio_id = f.id), 0)
    from reservations r
    join folios f  on f.reservation_id = r.id
    join guests g  on g.id = r.guest_id
   where r.hotel_id = p_hotel_id
     -- Checked in, with an open folio. A reservation that has not arrived has
     -- nobody in the restaurant; a departed one has a folio that is closed.
     and r.status = 'checked_in'
     and f.status = 'open'
     -- And holding a room. Checked in without one is a real state, and it is
     -- not a room a waiter can charge to. The original inner join said this
     -- implicitly; said out loud now, because it is a rule.
     and exists (select 1 from room_assignments ra
                  where ra.reservation_id = r.id and ra.released_at is null)
   order by 1
$fn$;

comment on function app.pos_chargeable_rooms(uuid) is
  'Rooms a POS may charge: checked in, folio open, holding a room -- ONE row '
  'per stay, even one that has moved rooms. The waiter list and the API '
  'refusal both read this, so a room cannot appear in one and be refused by '
  'the other.';
