-- =============================================================================
-- 139 · Correcting a closed day's other charges (D24-13, D25-5 to D25-11)
-- =============================================================================
-- The owner, 25 September: every charge on a closed day's bills may be
-- corrected on Closed days, not only its room and no-show charges (D25-5) - a
-- restaurant bill charged to a room included, on the room bill only (D25-6).
-- The same correction as the closed-day correction migration: the same table,
-- the same one exception to "nothing is posted to a closed day", unchanged.
--
-- One column. A corrected restaurant bill stays under "POS to PMS Posting" on
-- the Manager report (D25-10), but its right charge names the correction
-- (source_type 'correction'), not the till. So the correction keeps where the
-- charge first came from - carried along when a correction is corrected again.
-- Null on the corrections made before this file: room and no-show charges.
--
-- Re-runnable (root MEMORY 317).
-- =============================================================================

alter table closed_day_corrections add column if not exists origin text;

comment on column closed_day_corrections.origin is
  'Where the corrected charge first came from (the source_type of the line '
  'before any correction): ''pos'' for a restaurant bill charged to the room. '
  'The Manager report reads it (D25-10).';
