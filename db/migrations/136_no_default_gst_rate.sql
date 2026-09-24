-- =============================================================================
-- 136 · A new hotel has no GST rate until somebody sets one (D22-9)
-- =============================================================================
-- Refer to this file by what it does, never by its number (the master
-- renumbers at merge).
--
-- 019 gave `hotels.cgst_rate` and `hotels.sgst_rate` a default of 2.5 each, so
-- every hotel made since was born charging 2.5% + 2.5% that nobody chose - a
-- price the system invented, the one thing this project never ships. 067
-- moved the rate a posting carries into `tax_rules`; the pair is still read by
-- the Lodging tax sheet's heading and the property record.
--
-- So the default goes, and the NOT NULL with it: a hotel inserted without a
-- rate holds null, which every reader shows as a dash. The rates already
-- stored are NOT touched - this changes what a NEW row gets, nothing else.
-- 019's `add column if not exists` is skipped on every replay after the first,
-- so its default does not come back.
-- =============================================================================

alter table hotels
  alter column cgst_rate drop default,
  alter column cgst_rate drop not null,
  alter column sgst_rate drop default,
  alter column sgst_rate drop not null;

comment on column hotels.cgst_rate is
  'SUPERSEDED by tax_rules (067) for what a posting carries. No default since '
  'D22-9: null until somebody sets it, shown as a dash. Read only by the '
  'Lodging tax heading and the property record.';

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'hotels' and column_name in ('cgst_rate', 'sgst_rate')
       and (column_default is not null or is_nullable = 'NO')
  ) then
    raise exception 'hotels.cgst_rate / sgst_rate still carry a default or refuse null';
  end if;
end $$;
