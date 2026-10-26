-- =============================================================================
-- 240 · The owner's restaurant allowance (the owner's D27-355, D27-365 (1), D27-366)
-- =============================================================================
-- The owner takes up to a set amount a month from the restaurant free; above
-- it, a set % off. Both are this hotel's own settings, typed by the owner or
-- an Admin, and NOTHING IS BUILT IN: both start blank, and until the amount
-- is typed no bill can go on the allowance (no default prices). The month
-- is the hotel's business month and starts again on the 1st, nothing carried.
-- The GM, the owner or an Admin settles a bill to it: what is left of the
-- month's amount pays first (a tender of its own, 'allowance'); the rest gets
-- the % off and is paid there and then by cash, card or UPI. GST is charged on
-- the menu price as for any sale (D27-366, until the CA says otherwise).
--
-- Re-runnable.
-- =============================================================================

alter table hotels add column if not exists owner_allowance_monthly numeric(12,2);
alter table hotels add column if not exists owner_allowance_off_pct numeric(5,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotels_owner_allowance_sane') then
    alter table hotels add constraint hotels_owner_allowance_sane check (
      (owner_allowance_monthly is null or owner_allowance_monthly >= 0)
      and (owner_allowance_off_pct is null or owner_allowance_off_pct between 0 and 100));
  end if;
end $$;
comment on column hotels.owner_allowance_monthly is
  'D27-355: what the owner takes free from the restaurant each business month, in rupees. Blank: no allowance.';
comment on column hotels.owner_allowance_off_pct is
  'D27-365 (1): the % off a bill above the month''s free amount. Blank: not set (a bill above the free amount is refused).';

alter table pos_orders add column if not exists on_owner_allowance boolean not null default false;
comment on column pos_orders.on_owner_allowance is
  'D27-366: settled to the owner''s allowance - its allowance tender is the free part, its discount the % off above it.';

-- ── 'allowance', a way a bill is paid (099's and 038's lists, one word more) ──
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_tenders_method_valid'
                    and pg_get_constraintdef(oid) like '%allowance%') then
    alter table pos_order_tenders drop constraint if exists pos_order_tenders_method_valid;
    alter table pos_order_tenders add constraint pos_order_tenders_method_valid check (
      method in ('room', 'cash', 'card', 'upi', 'function', 'allowance'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_payment_valid'
                    and pg_get_constraintdef(oid) like '%allowance%') then
    alter table pos_orders drop constraint if exists pos_orders_payment_valid;
    alter table pos_orders add constraint pos_orders_payment_valid check (
      payment_method is null
      or payment_method in ('room', 'cash', 'card', 'upi', 'split', 'function', 'allowance'));
  end if;
end $$;

-- ── A test hotel copies the allowance, as it copies the round-off (229's list, two more) ──
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
  ('owner_allowance_monthly', true), ('owner_allowance_off_pct', true),
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;
