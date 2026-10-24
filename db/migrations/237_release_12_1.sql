-- =============================================================================
-- 237 · Release 12.1 (the owner's D27-363, 25 October)
-- =============================================================================
--   * pos_kot_stations.slip_mm: a printing computer's shortest slip. The
--     Fidato Printer app's KOTs came out sideways on the BAR PC while its
--     longer bills came out upright (MEMORY 427): a receipt printer's driver
--     turns a page it takes for landscape. Each slip is as long as it needs
--     and never shorter than this; null is the system's 160 mm, a little
--     above the bills that printed upright. Set and tested in Restaurant
--     setup, KOT section, on the computer itself.
--
-- Re-runnable.
-- =============================================================================

alter table pos_kot_stations add column if not exists slip_mm int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_kot_stations_slip_mm_sane') then
    alter table pos_kot_stations add constraint pos_kot_stations_slip_mm_sane
      check (slip_mm is null or slip_mm between 60 and 400);
  end if;
end $$;
comment on column pos_kot_stations.slip_mm is
  'This computer''s shortest slip, in mm (D27-363): a slip is as long as it needs and never shorter. '
  'Null: 160 mm. A KOT that prints sideways is made longer here.';
