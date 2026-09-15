-- =============================================================================
-- 019_property_details.sql — what a property is, beyond its name
-- =============================================================================
-- Found at CP9b, swapping the properties repository from fixtures onto HTTP.
-- The interface asks a property for its address, its phone, its email and its
-- GST rates. `hotels` carried none of them.
--
-- None is cosmetic:
--
--   address / phone / email   a GST invoice must print the supplier's address.
--                             Without it the invoice is not a valid tax
--                             document, and the Invoices screen has nowhere to
--                             read it from.
--
--   cgst_rate / sgst_rate     the rate lives per POSTING (folio_postings.
--                             tax_rate), which is right — a rate is fixed at
--                             the moment of sale and must not move when the
--                             statute changes. But nothing said what rate to
--                             APPLY to the next posting, so every charge would
--                             have had to be told its own tax by the caller.
--
-- Why on `hotels` and not one group-wide setting: GST is a state subject. A
-- property in Maharashtra and one in Uttar Pradesh can sit on different rates,
-- and the group has properties in both.
-- =============================================================================

alter table hotels add column if not exists address_line text;
alter table hotels add column if not exists phone        text;
alter table hotels add column if not exists email        citext;

-- 2.5 + 2.5 is the Indian hotel rate below the ₹7,500 tariff threshold, which
-- is where every property in this group sits. Above it the rate is 9 + 9, and
-- when a property crosses that line this column is where it changes — not a
-- constant in application code.
alter table hotels add column if not exists cgst_rate numeric(5,2) not null default 2.5;
alter table hotels add column if not exists sgst_rate numeric(5,2) not null default 2.5;

alter table hotels drop constraint if exists hotels_tax_rates_sane;
alter table hotels
  add constraint hotels_tax_rates_sane
  check (cgst_rate >= 0 and cgst_rate <= 100
     and sgst_rate >= 0 and sgst_rate <= 100);

comment on column hotels.cgst_rate is
  'Central GST, per property because GST is a state subject. The rate to apply '
  'to a NEW posting. A posting already made keeps the rate it was made at — '
  'that lives on folio_postings.tax_rate and must never be recomputed.';


-- -----------------------------------------------------------------------------
-- The two seeded properties, so nothing reads null.
-- -----------------------------------------------------------------------------
update hotels set address_line = coalesce(address_line, city || ', ' || coalesce(state, 'India'))
 where address_line is null;


do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'hotels' and column_name = 'cgst_rate'
  ) then
    raise exception '019: hotels.cgst_rate was not created';
  end if;
end $$;
