-- =============================================================================
-- 141 · The hotel's FSSAI licence number (the audit's A16; the owner, 26 Sep)
-- =============================================================================
-- FSSAI's orders of 8 June and 30 September 2021, in force from 1 January 2022:
-- every food business prints its 14-digit FSSAI licence or registration number
-- on its bills. The owner, 26 September: a per-hotel setting the owner, an
-- administrator or the GM types, printed on every restaurant bill and on a
-- stay's tax invoice when it carries food - a dash until typed. Nothing is
-- assumed: null until somebody types it, and only 14 digits are kept.
-- =============================================================================

alter table hotels add column if not exists fssai_number text;
alter table hotels drop constraint if exists hotels_fssai_shape;
alter table hotels add constraint hotels_fssai_shape
  check (fssai_number is null or fssai_number ~ '^[0-9]{14}$');

comment on column hotels.fssai_number is
  'The hotel''s 14-digit FSSAI licence or registration number, printed on food '
  'bills (A16). Null until typed: the bill prints a dash.';
