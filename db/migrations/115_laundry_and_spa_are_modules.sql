-- =============================================================================
-- 115 · Laundry and spa are modules a property is switched on for
-- =============================================================================
-- The owner's D17-54: laundry and spa, "each behind a per-hotel on/off switch -
-- it shows only where switched on". Both chats start on 18 September, side by
-- side, and each would have had to widen `hotel_modules_known` to name itself.
--
-- THAT IS WHY THE MASTER WRITES THIS AND NOT THEY. Two chats rewriting one
-- constraint in two migrations is the fault this project met three times in
-- two days (MEMORY 284, 293, 299): every deploy replays from 001, the older
-- file puts its narrower list back, and Postgres validates it against the rows
-- that exist. One file, written once, guarded by what it adds.
--
-- OFF EVERYWHERE, and no row is written. `app.module_enabled` reads an absent
-- row as off for anything but `pos`, so every property - and every property
-- made later - stays off until the owner or an administrator turns it on
-- (D17-36: the switches are theirs).
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'hotel_modules'::regclass
       and conname  = 'hotel_modules_known'
       and pg_get_constraintdef(oid) like '%laundry%'
       and pg_get_constraintdef(oid) like '%spa%'
  ) then
    alter table hotel_modules drop constraint if exists hotel_modules_known;
    alter table hotel_modules add constraint hotel_modules_known
      check (module in ('pos', 'banquet', 'reception_pos', 'channel_manager',
                        'laundry', 'spa'));
  end if;
end $$;
