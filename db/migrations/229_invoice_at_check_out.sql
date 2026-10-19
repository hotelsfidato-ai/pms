-- =============================================================================
-- 229 · The tax invoice at check-out: when, and how many copies (the owner's
--       D27-344, 19 October)
-- =============================================================================
-- (1) `hotels.invoice_at_checkout`: what check-out does with the tax invoice.
--       print     - issues it and prints it, by itself (the default, D27-344)
--       offer     - offers "Issue tax invoice" on the bill (D27-341's way)
--       invoices  - nothing at check-out; it is issued on Invoices
-- (2) `hotels.invoice_copies`: 2 (the default) prints "ORIGINAL FOR RECIPIENT"
--     and "DUPLICATE FOR SUPPLIER" (CGST Rule 48: a service's invoice is made
--     in duplicate); 1 prints the original alone.
-- (3) A test hotel copies both from its real hotel (the test hotels suite
--     refuses a hotels column nobody decided - 228's list, two added).
--
-- Re-runnable.
-- =============================================================================

alter table hotels add column if not exists invoice_at_checkout text not null default 'print';
alter table hotels drop constraint if exists hotels_invoice_at_checkout_check;
alter table hotels add constraint hotels_invoice_at_checkout_check
  check (invoice_at_checkout in ('print', 'offer', 'invoices'));
comment on column hotels.invoice_at_checkout is
  'D27-344: at check-out the tax invoice is issued and printed (print, the default), offered '
  'as a button (offer), or left to Invoices (invoices).';

alter table hotels add column if not exists invoice_copies smallint not null default 2;
alter table hotels drop constraint if exists hotels_invoice_copies_check;
alter table hotels add constraint hotels_invoice_copies_check check (invoice_copies in (1, 2));
comment on column hotels.invoice_copies is
  'D27-344: copies of a printed tax invoice - 2, original for recipient and duplicate for '
  'supplier (CGST Rule 48), or 1.';

create or replace function app.test_hotel_hotels_columns()
returns table (column_name text, copied boolean)
language sql
immutable
as $$
  values
  ('city', true), ('state', true), ('timezone', true), ('currency', true),
  ('check_in_time', true), ('check_out_time', true), ('night_audit_opens_at', true), ('address_line', true),
  ('phone', true), ('email', true), ('cgst_rate', true), ('sgst_rate', true),
  ('early_checkin_charge', true), ('late_checkout_charge', true),
  ('address_line_2', true), ('pin', true), ('website', true),
  ('reservations_phone', true), ('property_type', true), ('star_rating', true),
  ('latitude', true), ('longitude', true), ('reservations_contact', true),
  ('house_policies', true), ('food_cost_basis', true), ('default_payment_method', true),
  ('desk_may_overbook', true), ('advance_before_check_in', true), ('weekend_days', true),
  ('default_id_type', true), ('default_nationality', true), ('default_title', true),
  ('default_guarantee', true), ('default_bill_to', true), ('required_booking_fields', true),
  ('hk_dirty_after_move', true), ('hk_dirty_after_unblock', true),
  ('hk_stayover_dirty_at_audit', true), ('id_types_off', true), ('status_colours', true),
  ('pos_round_off', true), ('kpi_day_use_half', true), ('kpi_comp_as_sold', true),
  ('child_free_age', true), ('child_max_age', true),
  ('invoice_at_checkout', true), ('invoice_copies', true),
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;
