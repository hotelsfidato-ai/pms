-- =============================================================================
-- 258 · Shimla and Amrapali can never be reset - the server refuses (D27-381, D27-396)
-- =============================================================================
-- The owner, 29 October: "I don't want to reset this Shimla and Amrapali data
-- ok, these not be touched". Until now that was a promise kept by people; the
-- owner asked for a refusal by the system itself. Shimla's one fresh start
-- (D27-388) was done on 2 November, before this.
--
-- A hotel with reset_locked is refused by owner_reset.refusal, which BOTH ways
-- of clearing a hotel ask before anything goes: the owner's button on
-- Properties (api/src/modules/admin/ownerReset.ts, through owner_reset.counts
-- and owner_reset.clear) and api/scripts/reset-property.ts (the same two). The
-- lock, once on, cannot be lifted: a trigger refuses it, whoever asks.
--
-- Re-runnable: replayed on every deploy, it locks SHI and AMR again if either
-- was ever made after the last run, and changes nothing otherwise.
-- =============================================================================

alter table hotels add column if not exists reset_locked boolean not null default false;

comment on column hotels.reset_locked is
  'D27-381: this hotel can never be cleared by the full reset (owner_reset.refusal). '
  'Once true it stays true (hotels_reset_lock_stays).';

-- The lock stays on. Before the update below, so even this file cannot lift it.
create or replace function app.reset_lock_stays()
returns trigger
language plpgsql
as $$
begin
  if old.reset_locked and not new.reset_locked then
    raise exception '% can never be reset, and that lock is not lifted (D27-381).', old.code
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists hotels_reset_lock_stays on hotels;
create trigger hotels_reset_lock_stays
  before update of reset_locked on hotels
  for each row execute function app.reset_lock_stays();

update hotels set reset_locked = true where code in ('SHI', 'AMR') and not reset_locked;

-- As 250 wrote it, with the lock first: a locked hotel is refused before
-- anything else is asked.
create or replace function owner_reset.refusal(p_hotel uuid)
returns text
language sql
stable
as $fn$
  select case
    when h.reset_locked then
      format('%s (%s) can never be reset: the owner locked it (D27-381).', h.name, h.code)
    when h.test_of is not null then
      format('%s is a test hotel. It keeps its own Reset, on %s''s card on Properties.',
             h.code, (select r.code from hotels r where r.id = h.test_of))
    when i.n > 0 then
      format('%s checked in at %s: %s. Check them out before the hotel is cleared.',
             case when i.n = 1 then 'A guest is still' else i.n || ' guests are still' end,
             h.name, i.names)
    end
    from hotels h
    cross join lateral (
      select count(*) as n, string_agg(g.full_name, ', ' order by g.full_name) as names
        from reservations r join guests g on g.id = r.guest_id
       where r.hotel_id = h.id and r.status = 'checked_in') i
   where h.id = p_hotel
$fn$;

-- A test hotel never takes the lock: it keeps its own Reset (242's list, one more).
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
  ('test_of', false), ('reset_locked', false)
$$;
