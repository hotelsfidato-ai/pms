-- =============================================================================
-- 257 · Two-step sign-in with an authenticator app (D27-384, D27-396)
-- =============================================================================
-- The safety work the owner put before every feature (D27-384), built in our
-- own API because Firebase's own two-step needs a paid plan. The recommendation
-- taken under D27-396:
--
--   * a person sets it up on their own account: a key for Google Authenticator
--     or Microsoft Authenticator (a QR code), one 6-digit code to confirm, and
--     10 recovery codes shown once. The codes themselves are the API's
--     (RFC 6238 with Node's crypto, api/src/modules/admin/twoStep.ts);
--   * the API asks once per SIGN-IN (Firebase's auth_time), not per request:
--     a person with two-step on must have passed a code for that sign-in, or
--     every route but the two-step ones refuses;
--   * five wrong codes in a quarter of an hour and it stops; every code typed
--     is kept (two_step_log);
--   * a group setting, "required for the owner, an Admin, a GM and an
--     Accountant", OFF by default, so deploying this locks nobody out;
--   * the owner, or an Admin for the people at their hotel, switches somebody's
--     off (a lost phone) with a reason, in the audit log.
--
-- WHERE THE SECRET LIVES. Like the sign-in history (188) and the guest's codes
-- (114): in a table no policy opens and pms_app cannot read, reached only
-- through the definer functions below. The authenticator's key cannot be a
-- hash (the API needs it to work out the code), so the API is handed it only
-- inside a try that is already counted (app.two_step_try). A recovery code is
-- kept as its sha256, never as itself.
--
-- Re-runnable; group_settings gains one column, two new tables.
-- =============================================================================


-- =============================================================================
-- 1 · The group's setting
-- =============================================================================
alter table group_settings add column if not exists two_step_required boolean not null default false;

comment on column group_settings.two_step_required is
  'D27-396: two-step sign-in required for the owner, an Admin, a GM and an Accountant. '
  'Off by default; when on, those roles set it up before going on.';


-- =============================================================================
-- 2 · A person's authenticator, and every code typed
-- =============================================================================
create table if not exists staff_two_step (
  staff_id     uuid primary key references staff(id),
  -- The authenticator's key, base32 as the app is given it (160 bits).
  secret       text not null check (secret ~ '^[A-Z2-7]{32}$'),
  -- sha256 (hex) of each recovery code not yet used.
  recovery     text[] not null default '{}',
  -- The last 30-second step a code was taken for: no code is taken twice.
  last_step    bigint,
  created_at   timestamptz not null default now(),
  -- Null while it is being set up; on from the first right code.
  confirmed_at timestamptz
);

comment on table staff_two_step is
  'D27-396: a person''s authenticator key and their unused recovery codes (hashed). '
  'No policy opens it; read and written only by the app.two_step_* functions.';

create table if not exists two_step_log (
  id        bigserial primary key,
  staff_id  uuid not null references staff(id),
  -- The sign-in the code was typed for (Firebase's auth_time).
  auth_time timestamptz not null,
  at        timestamptz not null default now(),
  -- False until the code is found right: a wrong one stays false and counts.
  ok        boolean not null default false,
  kind      text check (kind in ('code', 'recovery'))
);
create index if not exists two_step_log_tries on two_step_log (staff_id, at);
create index if not exists two_step_log_passes on two_step_log (staff_id, auth_time) where ok;

comment on table two_step_log is
  'D27-396: every two-step code typed - a right one is the pass for that sign-in, '
  'a wrong one counts towards five in a quarter of an hour.';

alter table staff_two_step enable row level security;
alter table staff_two_step force row level security;
alter table two_step_log enable row level security;
alter table two_step_log force row level security;
revoke all on staff_two_step from pms_app;
revoke all on two_step_log from pms_app;
revoke all on sequence two_step_log_id_seq from pms_app;


-- =============================================================================
-- 3 · Who must, and where a person stands
-- =============================================================================
-- Required of this person: the setting is on, and they are the owner (a group
-- administrator, or owner at a hotel), an Admin, a GM or an Accountant
-- (`finance`) somewhere.
create or replace function app.two_step_required_of(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select g.two_step_required from group_settings g where g.id = 1), false)
     and exists (
       select 1 from staff s
        where s.id = p_staff
          and (s.is_group_admin or exists (
                 select 1 from staff_hotels sh
                  where sh.staff_id = s.id and sh.role in ('owner', 'admin', 'gm', 'finance'))))
$$;

-- The signed-in person, at this sign-in: 'off' (nothing asked), 'passed',
-- 'code' (two-step is on and this sign-in has not passed a code) or 'setup'
-- (their role needs it and they have none). Null for nobody: the route's own
-- withSession answers that with a 401.
create or replace function app.two_step_state(p_auth_time timestamptz)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when t.confirmed_at is not null then
      case when exists (select 1 from two_step_log l
                         where l.staff_id = s.id and l.auth_time = p_auth_time
                           and l.ok and l.at >= t.confirmed_at)
           then 'passed' else 'code' end
    when app.two_step_required_of(s.id) then 'setup'
    else 'off'
  end
    from staff s
    left join staff_two_step t on t.staff_id = s.id
   where s.id = app.current_user_id() and s.is_active
$$;

-- The person's own, for their account: where they stand, how many recovery
-- codes are left, and whether the group requires it.
create or replace function app.my_two_step(p_auth_time timestamptz)
returns table (state text, recovery_left int, required boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.two_step_state(p_auth_time),
         (select cardinality(t.recovery) from staff_two_step t
           where t.staff_id = app.current_user_id() and t.confirmed_at is not null),
         coalesce((select g.two_step_required from group_settings g where g.id = 1), false)
$$;

-- Whether somebody has it on: told to whoever may switch it off, and to the
-- person themselves; null to anybody else.
create or replace function app.has_two_step(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_staff = app.current_user_id() or app.may_see_sign_ins(p_staff)
    then exists (select 1 from staff_two_step t where t.staff_id = p_staff and t.confirmed_at is not null)
  end
$$;


-- =============================================================================
-- 4 · Setting it up, and every code typed
-- =============================================================================
-- A new key for the signed-in person, not yet on. Starting again replaces a key
-- never confirmed; a key already on is refused (a new phone: switched off first).
create or replace function app.two_step_begin(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := app.current_user_id();
begin
  if me is null then
    raise exception 'No active staff record for this account.' using errcode = '42501';
  end if;
  insert into staff_two_step (staff_id, secret) values (me, p_secret)
  on conflict (staff_id) do update
     set secret = excluded.secret, created_at = now(), last_step = null, recovery = '{}'
   where staff_two_step.confirmed_at is null;
  if not found then
    raise exception 'Two-step sign-in is already on for you. For a new phone, ask the owner or an Admin to switch it off first.'
      using errcode = '23514';
  end if;
end
$$;

-- One try, counted BEFORE it is checked, with the person's row held until the
-- answer: two tries at once cannot both slip under the limit. Hands the API the
-- key, the last step taken and the recovery hashes, to check the code against.
create or replace function app.two_step_try(p_auth_time timestamptz)
returns table (attempt bigint, secret text, last_step bigint, confirmed boolean, recovery text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me   uuid := app.current_user_id();
  t    staff_two_step;
  v_id bigint;
begin
  select * into t from staff_two_step s where s.staff_id = me for update;
  if t.staff_id is null then
    raise exception 'Two-step sign-in is not set up for you yet.' using errcode = '23514';
  end if;
  if (select count(*) from two_step_log l
       where l.staff_id = me and not l.ok and l.at > now() - interval '15 minutes') >= 5 then
    raise exception 'Five wrong codes in a quarter of an hour. Wait 15 minutes and try again, or ask the owner or an Admin to switch two-step sign-in off.'
      using errcode = '54000';
  end if;
  insert into two_step_log (staff_id, auth_time) values (me, p_auth_time) returning id into v_id;
  return query select v_id, t.secret, t.last_step, t.confirmed_at is not null, t.recovery;
end
$$;

-- The try was right: it is this sign-in's pass. A code's step is kept so it is
-- never taken again; a recovery code is struck off; the first right code turns
-- it on, with the new recovery codes' hashes. Returns the recovery codes left.
create or replace function app.two_step_passed(
  p_attempt bigint, p_step bigint, p_used_recovery text, p_new_recovery text[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid := app.current_user_id();
  t      staff_two_step;
  v_left int;
begin
  select * into t from staff_two_step s where s.staff_id = me for update;
  if t.staff_id is null or (p_new_recovery is not null) <> (t.confirmed_at is null)
     or (p_used_recovery is not null and not (p_used_recovery = any (t.recovery))) then
    raise exception 'That code cannot be taken.' using errcode = '23514';
  end if;
  update two_step_log
     set ok = true, kind = case when p_used_recovery is null then 'code' else 'recovery' end
   where id = p_attempt and staff_id = me and not ok;
  if not found then
    raise exception 'That code cannot be taken.' using errcode = '23514';
  end if;
  update staff_two_step
     set last_step    = coalesce(p_step, last_step),
         recovery     = coalesce(p_new_recovery, array_remove(recovery, p_used_recovery)),
         confirmed_at = coalesce(confirmed_at, now())
   where staff_id = me
  returning cardinality(recovery) into v_left;
  if p_new_recovery is not null then
    insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
    values (null, me, 'staff', me::text, 'TWO_STEP_ON', null,
            jsonb_build_object('by', (select full_name from staff where id = me)));
  end if;
  return v_left;
end
$$;


-- =============================================================================
-- 5 · Switched off by somebody else (a lost phone), and the group's setting
-- =============================================================================
-- The owner anybody's; an owner or Admin the people at their hotel - the same
-- people who read and sign out their devices (app.may_see_sign_ins, 190).
create or replace function app.two_step_off(p_staff uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := app.current_user_id();
begin
  if not app.may_see_sign_ins(p_staff) then
    raise exception 'Switching two-step sign-in off is for the owner, and an Admin for the people at their hotel.'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why two-step sign-in is switched off - a lost phone, for example.' using errcode = '23514';
  end if;
  delete from staff_two_step where staff_id = p_staff and confirmed_at is not null;
  if not found then
    raise exception 'Two-step sign-in is not on for this person.' using errcode = '23514';
  end if;
  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (null, me, 'staff', p_staff::text, 'TWO_STEP_OFF', null,
          jsonb_build_object('reason', btrim(p_reason),
                             'whose', (select full_name from staff where id = p_staff),
                             'by', (select full_name from staff where id = me)));
end
$$;

-- On or off for the group: the owner or an Admin with a real hotel. Switched on
-- only by somebody who has their own on, so switching it on cannot lock out the
-- person doing it. The table's own audit trigger keeps who and when.
create or replace function app.set_two_step_required(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (app.has_real_hotel() and (app.is_group_admin() or exists (
            select 1 from staff_hotels sh join staff s on s.id = sh.staff_id
             where sh.staff_id = app.current_user_id() and s.is_active
               and sh.role in ('owner', 'admin')))) then
    raise exception 'Whether two-step sign-in is required is for the owner or an Admin.' using errcode = '42501';
  end if;
  if p_on and not exists (select 1 from staff_two_step t
                           where t.staff_id = app.current_user_id() and t.confirmed_at is not null) then
    raise exception 'Set up your own two-step sign-in first (your account menu, Two-step sign-in), so this cannot lock you out.'
      using errcode = '23514';
  end if;
  insert into group_settings (id, two_step_required, changed_by)
  values (1, coalesce(p_on, false), app.current_user_id())
  on conflict (id) do update
     set two_step_required = excluded.two_step_required,
         changed_by = excluded.changed_by, changed_at = now();
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.two_step_required_of(uuid)', 'app.two_step_state(timestamptz)',
    'app.my_two_step(timestamptz)', 'app.has_two_step(uuid)', 'app.two_step_begin(text)',
    'app.two_step_try(timestamptz)', 'app.two_step_passed(bigint, bigint, text, text[])',
    'app.two_step_off(uuid, text)', 'app.set_two_step_required(boolean)']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to pms_app', f);
  end loop;
end $$;


-- =============================================================================
-- 6 · The test hotel's classes
-- =============================================================================
-- As 255 left them, with the two new tables: the group's, like sign_ins.
create or replace function app.test_hotel_classes()
returns table (table_name text, class text)
language sql
immutable
as $$
  values
  -- setup ------------------------------------------------------------------
  ('room_types', 'setup'), ('rooms', 'setup'), ('room_type_amenities', 'setup'),
  ('room_type_photos', 'setup'), ('rates', 'setup'), ('rate_offsets', 'setup'),
  ('rate_plan_settings', 'setup'), ('rate_plan_sources', 'setup'),
  ('rate_restrictions', 'setup'), ('pricing_basis', 'setup'),
  ('booking_source_rates', 'setup'), ('room_promotions', 'setup'),
  ('cancellation_policies', 'setup'), ('inclusions', 'setup'),
  ('hotel_meal_days', 'setup'), ('hotel_holidays', 'setup'), ('tax_rules', 'setup'),
  ('tax_sac', 'setup'), ('payment_methods', 'setup'), ('hotel_lists', 'setup'),
  ('hotel_modules', 'setup'), ('hotel_texts', 'setup'), ('hotel_amenities', 'setup'),
  ('hotel_logos', 'setup'), ('hotel_photos', 'setup'), ('guest_message_settings', 'setup'),
  ('pos_outlets', 'setup'), ('pos_sections', 'setup'), ('pos_tables', 'setup'),
  ('pos_menu_categories', 'setup'), ('pos_menu_items', 'setup'),
  ('pos_item_variations', 'setup'), ('pos_addon_groups', 'setup'), ('pos_addons', 'setup'),
  ('pos_item_addon_groups', 'setup'), ('pos_numbered_addons', 'setup'),
  ('pos_kot_kinds', 'setup'), ('pos_promotions', 'setup'), ('locations', 'setup'),
  ('stock_items', 'setup'), ('bar_pours', 'setup'), ('recipe_lines', 'setup'),
  ('tally_ledger_names', 'setup'),
  ('stock_levels', 'setup'), ('suppliers', 'setup'),
  ('equipment_categories', 'setup'), ('laundry_price_items', 'setup'),
  ('spa_therapists', 'setup'), ('spa_treatments', 'setup'), ('banquet_venues', 'setup'),
  ('banquet_packages', 'setup'), ('approval_rules', 'setup'),
  ('purchase_requesters', 'setup'), ('review_links', 'setup'),
  -- trading ----------------------------------------------------------------
  ('reservations', 'trading'), ('reservation_inclusions', 'trading'),
  ('stay_companions', 'trading'),
  ('room_assignments', 'trading'), ('room_blocks', 'trading'),
  ('room_status_log', 'trading'), ('housekeeping_assignments', 'trading'),
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'), ('refunds', 'trading'),
  ('invoices', 'trading'), ('vat_bills', 'trading'), ('closed_day_corrections', 'trading'),
  ('night_audit_runs', 'trading'), ('night_audit_undos', 'trading'), ('form_c_filings', 'trading'),
  ('form_iii_stays', 'trading'), ('guest_links', 'trading'), ('guest_link_codes', 'trading'),
  ('guest_unlocks', 'trading'), ('guest_desk_replies', 'trading'),
  ('guest_detail_submissions', 'trading'), ('guest_digilocker_attempts', 'trading'),
  ('guest_food_orders', 'trading'), ('guest_id_photos', 'trading'),
  ('guest_id_photo_views', 'trading'), ('guest_requests', 'trading'),
  ('key_cards', 'trading'), ('wake_up_calls', 'trading'), ('lost_items', 'trading'),
  ('work_orders', 'trading'), ('work_order_costs', 'trading'), ('attachments', 'trading'),
  ('approvals', 'trading'), ('pos_orders', 'trading'), ('pos_order_lines', 'trading'),
  ('pos_order_tenders', 'trading'), ('pos_line_events', 'trading'),
  ('pos_tickets', 'trading'), ('pos_kot_prints', 'trading'), ('pos_kot_reprints', 'trading'),
  ('pos_bill_prints', 'trading'), ('bar_purchases', 'trading'), ('bar_purchase_lines', 'trading'),
  ('bar_requests', 'trading'), ('bar_request_lines', 'trading'), ('bar_closed_days', 'trading'),
  ('pos_tender_changes', 'trading'), ('pos_requests', 'trading'), ('pos_table_moves', 'trading'),
  ('pos_cash_movements', 'trading'), ('pos_day_ends', 'trading'),
  ('pos_denominations', 'trading'), ('cashier_shifts', 'trading'),
  ('cashier_movements', 'trading'), ('cashier_denominations', 'trading'),
  ('cashier_float_claims', 'trading'), ('cash_deposits', 'trading'),
  ('cash_deposit_notes', 'trading'), ('company_payments', 'trading'),
  ('credit_limit_allowances', 'trading'), ('contracts', 'trading'),
  ('contract_rates', 'trading'), ('banquet_events', 'trading'),
  ('banquet_event_packages', 'trading'), ('table_bookings', 'trading'),
  ('spa_appointments', 'trading'), ('laundry_dockets', 'trading'),
  ('laundry_docket_lines', 'trading'), ('loyalty_members', 'trading'),
  ('loyalty_points', 'trading'), ('stock_movements', 'trading'),
  ('stock_count_lines', 'trading'), ('purchase_requests', 'trading'),
  ('purchase_request_lines', 'trading'), ('supplier_bills', 'trading'),
  ('supplier_payments', 'trading'), ('supplier_credit_notes', 'trading'),
  ('supplier_reversals', 'trading'), ('equipment_items', 'trading'),
  ('equipment_history', 'trading'), ('equipment_moves', 'trading'),
  -- never ------------------------------------------------------------------
  ('staff_hotels', 'never'), ('channel_hotels', 'never'), ('channel_room_types', 'never'),
  ('channel_rate_plans', 'never'), ('channel_ari_sent', 'never'),
  ('channel_ari_pushes', 'never'), ('channel_bookings', 'never'), ('crs_hotels', 'never'),
  ('crs_room_types', 'never'), ('crs_bookings', 'never'), ('market_rate_settings', 'never'),
  ('market_rates', 'never'), ('daily_report_emails', 'never'), ('invoice_series', 'never'),
  ('vat_bill_series', 'never'), ('audit_log', 'never'), ('messages_sent', 'never'),
  ('hotel_bank_details', 'never'), ('pos_kot_stations', 'never'),
  ('hotel_setup_steps', 'never'),
  -- group ------------------------------------------------------------------
  ('hotels', 'group'), ('staff', 'group'), ('guests', 'group'), ('companies', 'group'),
  ('reservation_groups', 'group'), ('guest_documents', 'group'), ('guest_joins', 'group'),
  ('guest_not_same', 'group'), ('offer_opt_ins', 'group'), ('offer_opt_outs', 'group'),
  ('guest_messaging_began', 'group'), ('meal_plans', 'group'), ('booking_sources', 'group'),
  ('sales_people', 'group'), ('vip_levels', 'group'), ('amenities', 'group'),
  ('group_settings', 'group'), ('room_type_templates', 'group'),
  ('provisioning_keys', 'group'), ('sign_ins', 'group'), ('telemetry_events', 'group'),
  ('telemetry_requests', 'group'), ('schema_migrations', 'group'),
  ('staff_two_step', 'group'), ('two_step_log', 'group')
$$;
