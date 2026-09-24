-- =============================================================================
-- 130 · The room a guest moved out of is dirty (FD-9, the owner's D23-12)
-- =============================================================================
-- 054's move SHORTENS the old room's assignment when the guest has slept in it
-- (it releases only a room they never spent a night in), and 070/074's trigger
-- dirties a room only on a RELEASE. So the room a guest moved out of mid-stay
-- stayed clean, and Rooms offered it to the next guest - the very case 070's
-- header names: "the guest goes to 205 and 201 is left behind".
--
-- The fact is the NEW assignment, not the shortening: until the new room is
-- written, app.in_house (129) still puts the guest in the old one. So this
-- fires on the insert and asks, for every other room the same stay holds:
--
--   * cut short where the new one starts (a move or an exchange, not an
--     amended departure),
--   * on or before the business date (the guest has already left it; a move
--     dated tomorrow leaves tonight's room alone),
--   * the stay is checked in (somebody actually slept there - FD-10's
--     question, "did anybody go in?"),
--   * and nobody is in it now by app.in_house (an exchange puts the other
--     guest straight in, and a room is never dirtied under a guest).
--
-- Only a clean or inspected room is changed: a room out of service or out of
-- order keeps its state, as in 070, and a dirty one is dirty already.
--
-- ponytail: a move dated in the FUTURE is not dirtied when the business date
-- reaches it (no write happens then) - the same ceiling 129 names for the
-- occupancy column. Re-check a hotel's rooms when its night audit completes if
-- future-dated moves turn out to matter.
-- =============================================================================

create or replace function app.moved_out_room_is_dirty()
returns trigger
language plpgsql
as $$
begin
  update rooms rm
     set housekeeping_status = 'dirty'
    from room_assignments ra
    join reservations r on r.id = ra.reservation_id
   where ra.reservation_id = new.reservation_id
     and ra.id <> new.id
     and ra.released_at is null
     and ra.to_date = new.from_date
     and new.from_date <= app.business_date(new.hotel_id)
     and r.status = 'checked_in'
     and rm.id = ra.room_id
     and rm.housekeeping_status in ('clean', 'inspected')
     and not exists (select 1 from app.in_house(new.hotel_id) i
                      where i.room_id = rm.id);
  return new;
end $$;

comment on function app.moved_out_room_is_dirty() is
  'FD-9: a checked-in guest moved out of a room on or before the business date '
  'leaves it dirty, unless somebody is in it (app.in_house). A move shortens '
  'the old assignment rather than releasing it, so 070''s trigger never saw it.';

drop trigger if exists room_assignments_moved_out on room_assignments;
create trigger room_assignments_moved_out
  after insert on room_assignments
  for each row execute function app.moved_out_room_is_dirty();
