-- =============================================================================
-- 247 · The guest's company and GSTIN on a booking (the owner's D27-371,
--       27 October: "Company Name not mandatory, GST Number should be linked
--       to Report and Visible on Invoice, Company Address")
-- =============================================================================
-- Three optional facts the desk types on New booking's Guest card, kept on
-- every room of the booking. With a GSTIN, the stay's tax invoice for the
-- guest's bill is addressed to that company (finance's issuing route); the
-- guest still pays at the desk - nothing about who pays changes, and the
-- company is NOT a `companies` row (the owner chose not to add it to the
-- list). 'Bill to company' (company_id) is untouched and wins where both are.
--
-- The GSTIN's full check (its check digit) is gstinProblem in
-- api/src/validate.ts, asked by the server before the write; the constraint
-- below is the shape only, so nothing else can store a wrong-shaped one.
--
-- Re-runnable: columns added if absent, the constraint added once, guarded.
-- =============================================================================

alter table reservations add column if not exists guest_company_name    text;
alter table reservations add column if not exists guest_company_gstin   text;
alter table reservations add column if not exists guest_company_address text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_guest_company_gstin_shape') then
    alter table reservations add constraint reservations_guest_company_gstin_shape
      check (guest_company_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_guest_company_lengths') then
    alter table reservations add constraint reservations_guest_company_lengths
      check (length(guest_company_name) <= 200 and length(guest_company_address) <= 500);
  end if;
end $$;

comment on column reservations.guest_company_gstin is
  'The guest''s own company''s GSTIN, typed at booking (D27-371): the tax invoice '
  'for the guest''s bill is addressed to it; the guest still pays.';
