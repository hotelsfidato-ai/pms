-- =============================================================================
-- 228 · Rooms in number order; the night audit's opening time (the owner's
--       D27-338, 16 October)
-- =============================================================================
-- (1) A plain text sort listed Mathura's rooms 10A, 10B, 11A, 11B, 1A, 1B, 2A
--     ... (and any hotel's room 10 before room 9). `app.room_order` is ICU's
--     numeric ordering: 1A, 1B, 2A ... 9B, 10A, 10B, 11A, 11B. The lists use it
--     in their ORDER BY (`number collate app.room_order`); the column itself
--     keeps the database's own collation, so every comparison and the unique
--     index are unchanged. Deterministic: equal only when the text is equal.
--
-- (2) `hotels.night_audit_opens_at`: before this time on the hotel's own
--     clock, nobody may run the night audit for today's business date; a
--     business date already behind is never locked (the night audit's
--     blockers say so). 16:00 to begin, as the owner asked; the owner or an
--     administrator changes it in Settings.
--
-- Re-runnable.
-- =============================================================================

create collation if not exists app.room_order (provider = icu, locale = 'und-u-kn-true');
comment on collation app.room_order is
  'Room numbers in number order (D27-338): 1A, 1B, 2A ... 9B, 10A, 11B; 9 before 10.';

alter table hotels add column if not exists night_audit_opens_at time not null default '16:00';
comment on column hotels.night_audit_opens_at is
  'D27-338: the night audit for today''s business date opens at this time on the '
  'hotel''s own clock (hotels.timezone); a business date already behind is never locked.';

-- (3) A test hotel copies its real hotel's opening time, as it copies the
--     check-in time (212's list, with the new column decided - the test
--     hotels suite refuses a hotels column nobody decided).
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
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;
