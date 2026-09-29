-- =============================================================================
-- 161 · New booking's fold-open sections, switched per hotel (D27-158, D27-163)
-- =============================================================================
-- The owner, 29 September: one page for booking, assigning and check-in, with
-- Company, GST, Extras and Notes in fold-open sections, "each switchable on or
-- off in Settings, per hotel". They are four more rows of hotel_modules, on
-- the Settings screen's existing switches (the owner and an administrator,
-- D17-36), read through the same app.module_enabled as every other switch.
--
-- ON UNTIL A HOTEL TURNS ONE OFF (D27-163: "the four switches start ON"), so
-- nothing that works on New booking today disappears. No row is written: an
-- absent row reads ON for these four, as for `pos`, at every property and every
-- property made later.
--
-- ⚠ Every deploy replays from 001 (MEMORY 284, 293, 299). The list below keeps
-- every module the earlier files name, and each of them is guarded by what it
-- adds, so none of them narrows it back.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'hotel_modules'::regclass
       and conname  = 'hotel_modules_known'
       and pg_get_constraintdef(oid) like '%booking_notes%'
  ) then
    alter table hotel_modules drop constraint if exists hotel_modules_known;
    alter table hotel_modules add constraint hotel_modules_known
      check (module in ('pos', 'banquet', 'reception_pos', 'channel_manager',
                        'laundry', 'spa', 'alcohol',
                        'booking_company', 'booking_gst', 'booking_extras',
                        'booking_notes'));
  end if;
end $$;

create or replace function app.module_enabled(p_hotel uuid, p_module text)
returns boolean language sql stable as $$
  select coalesce(
    (select is_enabled from hotel_modules
      where hotel_id = p_hotel and module = p_module),
    p_module in ('pos', 'booking_company', 'booking_gst', 'booking_extras',
                 'booking_notes')
  );
$$;

comment on function app.module_enabled(uuid, text) is
  'True when the property has this module. Absent rows mean ON for pos and for '
  'New booking''s four sections (161), OFF for everything else.';
