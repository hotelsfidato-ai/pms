-- =============================================================================
-- 242 · The KOT's design, one for each hotel (the owner's D27-368, 26 October)
-- =============================================================================
-- "Make it so that we can customise the KOT, with a view." The GM, the owner or
-- an Admin chooses, in Restaurant setup's KOT section with a live preview: the
-- size of the dishes, and of the KOT number and table (small, normal, large);
-- which lines print (waiter, covers, time sent, the KOT kind, notes, the order
-- number); a heading line of the hotel's own words; the paper, 58 or 80 mm.
-- Blank is today's KOT. The API checks the shape (kotDesign.ts).
--
-- Re-runnable.
-- =============================================================================

alter table hotels add column if not exists kot_design jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotels_kot_design_object') then
    alter table hotels add constraint hotels_kot_design_object
      check (kot_design is null or jsonb_typeof(kot_design) = 'object');
  end if;
end $$;
comment on column hotels.kot_design is
  'D27-368: the KOT''s design - sizes, the lines it prints, a heading, the paper width. Null: today''s KOT.';

-- ── A test hotel copies its KOT design (240's list, one more) ──────────────
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
  ('kot_design', true),
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;
