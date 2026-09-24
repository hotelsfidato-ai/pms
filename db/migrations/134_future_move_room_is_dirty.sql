-- =============================================================================
-- 134 · A move booked for a later night dirties the old room when that night
--       comes (the owner, 24 September)
-- =============================================================================
-- 130 dirties the room a checked-in guest moved out of when the move is
-- WRITTEN on or before the business date. A move dated later is written days
-- ahead, and nothing is written on the night it takes effect - so the room
-- the guest left stayed clean for the next one (130's own ponytail note).
--
-- The night it takes effect is the moment the business date reaches it, and
-- the business date moves in one place: a night audit run becoming
-- 'completed' (023 - app.business_date is the day after the last completed
-- run). So this asks 130's question there, once, for the whole hotel: a room
-- a checked-in stay's assignment ends in on the new business date, where
-- another of that stay's assignments starts (a move or an exchange, not a
-- departure), clean or inspected, and nobody in it by app.in_house (129).
--
-- No earlier function changes (MEMORY 317); a new function and a new trigger.
-- =============================================================================

create or replace function app.future_move_room_is_dirty()
returns trigger
language plpgsql
as $$
begin
  -- A run already completed being corrected (100) is not the date moving.
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;

  update rooms rm
     set housekeeping_status = 'dirty'
    from room_assignments ra
    join reservations r on r.id = ra.reservation_id
   where ra.hotel_id = new.hotel_id
     and ra.released_at is null
     and ra.to_date = app.business_date(new.hotel_id)
     and exists (select 1 from room_assignments nx
                  where nx.reservation_id = ra.reservation_id
                    and nx.id <> ra.id
                    and nx.released_at is null
                    and nx.from_date = ra.to_date)
     and r.status = 'checked_in'
     and rm.id = ra.room_id
     and rm.housekeeping_status in ('clean', 'inspected')
     and not exists (select 1 from app.in_house(new.hotel_id) i
                      where i.room_id = rm.id);
  return null;                                    -- AFTER trigger; ignored
end $$;

comment on function app.future_move_room_is_dirty() is
  'A move dated for a later night: when a night audit completes and the '
  'business date reaches it, the room the checked-in guest left is dirty, '
  'unless somebody is in it (app.in_house). 130 does the same for a move '
  'written on or before the business date.';

drop trigger if exists night_audit_runs_future_moves on night_audit_runs;
create trigger night_audit_runs_future_moves
  after insert or update of status on night_audit_runs
  for each row
  when (new.status = 'completed')
  execute function app.future_move_room_is_dirty();
