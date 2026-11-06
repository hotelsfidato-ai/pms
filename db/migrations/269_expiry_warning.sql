-- =============================================================================
-- 269 · How many days before its use-by a delivery is flagged (D27-383 item 11)
-- =============================================================================
-- The owner's list of 6 November (D27-383, item 11): expiry alerts on stock.
-- A delivery's use-by is already recorded (180, stock_movements.expires_on);
-- what each delivery still has on the shelf is worked out on the server, first
-- expiring first out (api/src/modules/stores/expiry.ts). This is the one figure
-- the hotel sets: how many days before the use-by the Store and the bell warn.
--
-- 7 days, decided under D27-396 (the master's recommendation; the owner
-- reviews): a setting per hotel, from 1 to 90 days. It is a period, not a
-- price, so it starts filled. An item with no use-by is never warned about.
--
-- Re-runnable.
-- =============================================================================

alter table hotels add column if not exists expiry_warn_days smallint not null default 7;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotels_expiry_warn_days_sane') then
    alter table hotels add constraint hotels_expiry_warn_days_sane check (expiry_warn_days between 1 and 90);
  end if;
end $$;

comment on column hotels.expiry_warn_days is
  'D27-383 item 11: the Store and the bell flag a delivery this many days before its use-by '
  '(and every day after it, while some of it is still on the shelf). 1 to 90; 7 to start (D27-396).';

-- ── A test hotel copies the warning, as its other settings (242's list, one more) ──
-- ⚠ For the master at merge: any other migration since 242 that adds a column to
-- `hotels` replaces this same list; the last one must carry every column.
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
  ('kot_design', true), ('expiry_warn_days', true),
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;
