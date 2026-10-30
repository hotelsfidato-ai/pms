-- =============================================================================
-- 253 · Every adult in a room is recorded (the owner's D27-382, GUE-6)
-- =============================================================================
-- The owner, 30 October: name, nationality, ID type and number for every adult;
-- a foreigner also has the full Form III details and a row of their own on the
-- register; entered at check-in or later on the stay; check-in is never
-- blocked; a missing person is a warning on the register. It replaces the
-- recording part of D27-25 (a warning and a portal number per person).
--
-- A COMPANION IS A GUEST. A booking knows one guest, reservations.guest_id. The
-- model already says what a person is: `guests` (the name and the nationality),
-- `guest_documents` (the ID, one row per person, its own row security),
-- `form_c_filings` (each already names a guest_id), `form_iii_stays` (one
-- visit's answers). All the model lacks is the link from a stay to its other
-- adults: `stay_companions`. No field of a person is copied into it, so the
-- ID rules, the Form III card, the restore tool and the audit work on a
-- companion as they do on a lead guest.
--
-- form_iii_stays is one row per stay today; a companion has their own answers,
-- so a row now names whose it is: guest_id NULL is the booking's lead guest
-- (every row until now, and it stays right if the lead's record is joined into
-- another: guest_join moves reservations.guest_id, and nothing here points at
-- it). Not NULL is a companion.
--
-- Re-runnable: replayed on every deploy (db/migrate.sh, one transaction).
-- =============================================================================


-- =============================================================================
-- 1 · THE LINK
-- =============================================================================
create table if not exists stay_companions (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id),
  -- No cascade, as form_iii_stays: a stay with a person on it is not deleted
  -- from under them; the two resets name this table before reservations.
  reservation_id uuid not null references reservations(id),
  guest_id       uuid not null references guests(id),
  added_by       uuid references staff(id),
  added_at       timestamptz not null default now(),

  constraint stay_companions_once unique (reservation_id, guest_id)
);

comment on table stay_companions is
  'The other adults in a room (D27-382): a stay and a guest record. Everything '
  'about the person is on guests and guest_documents, as for a lead guest; what '
  'Form III asks about the visit is their own form_iii_stays row.';

create index if not exists stay_companions_by_guest on stay_companions (guest_id);

alter table stay_companions enable row level security;
alter table stay_companions force  row level security;
drop policy if exists hotel_isolation on stay_companions;
create policy hotel_isolation on stay_companions
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- Nothing on it is corrected: a wrong person is taken off (app.remove_companion).
revoke update, delete on stay_companions from pms_app;

drop trigger if exists stay_companions_audit on stay_companions;
create trigger stay_companions_audit
  after insert or update or delete on stay_companions
  for each row execute function app.write_audit();

-- A real hotel's stay never holds a test hotel's guest, nor the other way (212).
drop trigger if exists stay_companions_keeps_sides on stay_companions;
create trigger stay_companions_keeps_sides
  before insert or update of hotel_id, guest_id on stay_companions
  for each row execute function app.keep_sides('guest_id', 'guests');


-- =============================================================================
-- 2 · ONE VISIT'S ANSWERS, PER PERSON
-- =============================================================================
alter table form_iii_stays add column if not exists guest_id uuid references guests(id);

comment on column form_iii_stays.guest_id is
  'Null: the booking''s lead guest. Otherwise the companion these answers are.';

alter table form_iii_stays drop constraint if exists form_iii_stays_reservation_id_key;
create unique index if not exists form_iii_stays_one_per_person
  on form_iii_stays (reservation_id, guest_id) nulls not distinct;

drop trigger if exists form_iii_stays_keeps_sides on form_iii_stays;
create trigger form_iii_stays_keeps_sides
  before insert or update of hotel_id, guest_id on form_iii_stays
  for each row execute function app.keep_sides('guest_id', 'guests');


-- =============================================================================
-- 3 · A COMPANION'S ID, AS A LEAD GUEST'S
-- =============================================================================
-- 212's three policies, with "or a companion on a stay at the caller's hotel":
-- a person's document is read where they stayed, and only there.
drop policy if exists gd_by_reservation        on guest_documents;
drop policy if exists gd_capture               on guest_documents;
drop policy if exists gd_update_by_reservation on guest_documents;
create policy gd_by_reservation on guest_documents for select
  using ((exists (select 1 from reservations r
                   where r.guest_id = guest_documents.guest_id
                     and r.hotel_id in (select app.auth_hotel_ids()))
          or exists (select 1 from stay_companions c
                      where c.guest_id = guest_documents.guest_id
                        and c.hotel_id in (select app.auth_hotel_ids())))
         and exists (select 1 from guests g where g.id = guest_documents.guest_id));
create policy gd_capture on guest_documents for insert
  with check (app.is_active_staff()
              and exists (select 1 from guests g where g.id = guest_documents.guest_id));
create policy gd_update_by_reservation on guest_documents for update
  using ((exists (select 1 from reservations r
                   where r.guest_id = guest_documents.guest_id
                     and r.hotel_id in (select app.auth_hotel_ids()))
          or exists (select 1 from stay_companions c
                      where c.guest_id = guest_documents.guest_id
                        and c.hotel_id in (select app.auth_hotel_ids())))
         and exists (select 1 from guests g where g.id = guest_documents.guest_id))
  with check ((exists (select 1 from reservations r
                        where r.guest_id = guest_documents.guest_id
                          and r.hotel_id in (select app.auth_hotel_ids()))
               or exists (select 1 from stay_companions c
                           where c.guest_id = guest_documents.guest_id
                             and c.hotel_id in (select app.auth_hotel_ids())))
              and exists (select 1 from guests g where g.id = guest_documents.guest_id));


-- =============================================================================
-- 4 · HOW MANY ARE RECORDED, AND TAKING A PERSON OFF
-- =============================================================================
-- The lead guest, and each companion whose document number is on record: the
-- owner's list is a name, a nationality, an ID type and a number. A companion
-- with a name and no number is on the stay and not yet recorded. Against
-- reservations.adults, for "2 adults, 1 recorded"; a child is not asked for.
-- Invoker: row security decides, as the register's own reads.
create or replace function app.stay_recorded(p_stay uuid)
returns int
language sql
stable
as $fn$
  select 1 + count(*)::int
    from stay_companions c
    join guest_documents d on d.guest_id = c.guest_id
   where c.reservation_id = p_stay and d.id_number is not null
$fn$;

grant execute on function app.stay_recorded(uuid) to pms_app;

-- Entered by mistake: their link, their answers and their ID go, nothing is
-- left that no screen can reach. Definer, because a record the desk may only
-- correct (form_iii_stays, guest_documents) is removed here and only here; the
-- guest's own row stays, as every guest's does (015). A filed Form III is kept
-- for a year (Rule 17(1)), so a person with one is refused. False: no such
-- person on the stay.
create or replace function app.remove_companion(p_hotel uuid, p_stay uuid, p_guest uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_hotel not in (select app.auth_hotel_ids()) then
    raise exception 'That stay is not at your hotel.' using errcode = '42501';
  end if;
  if exists (select 1 from form_c_filings f
              where f.reservation_id = p_stay and f.guest_id = p_guest) then
    raise exception 'This person''s Form III is filed: the record is kept for a year (Rule 17(1)), so they stay on it.';
  end if;

  delete from stay_companions
   where hotel_id = p_hotel and reservation_id = p_stay and guest_id = p_guest;
  if not found then
    return false;
  end if;
  delete from form_iii_stays where reservation_id = p_stay and guest_id = p_guest;
  -- A companion's record is made for one stay; the check is for one joined
  -- since into a guest who has others.
  delete from guest_documents d
   where d.guest_id = p_guest
     and not exists (select 1 from stay_companions c where c.guest_id = p_guest)
     and not exists (select 1 from reservations r where r.guest_id = p_guest);
  return true;
end
$fn$;

grant execute on function app.remove_companion(uuid, uuid, uuid) to pms_app;


-- =============================================================================
-- 5 · THE REGISTER: ONE ROW PER FOREIGNER
-- =============================================================================
-- A new name, as a return type never changes (MEMORY 317): every person it
-- answers for is named, with the stay's count of adults recorded. 147's
-- function is dropped, as it dropped form_c_due, so nothing reads the old
-- answer; a replay recreates it at 147 and comes through here again.
drop function if exists app.form_iii(uuid);

create or replace function app.form_iii_people(p_hotel_id uuid)
returns table (
  reservation_id         uuid,
  guest_id               uuid,
  companion              boolean,
  guest_name             text,
  nationality            text,
  gender                 text,
  date_of_birth          date,
  id_type                text,
  passport               text,
  passport_issued_on     date,
  passport_issue_place   text,
  passport_issue_country text,
  passport_expiry        date,
  visa_number            text,
  visa_type              text,
  visa_issued_on         date,
  visa_issue_place       text,
  visa_issue_country     text,
  visa_expiry            date,
  home_address           text,
  home_city              text,
  home_country           text,
  phone_in_india         text,
  mobile_in_india        text,
  phone_abroad           text,
  mobile_abroad          text,
  email                  text,
  remarks                text,
  arrived_from           text,
  previous_stay          text,
  purpose                text,
  purpose_other          text,
  arrived_in_india_on    date,
  arrival_port           text,
  employed_in_india      boolean,
  ref_address            text,
  ref_city               text,
  ref_state              text,
  ref_pincode            text,
  next_destination       text,
  room_number            text,
  adults                 int,
  recorded               int,
  children               int,
  check_in               date,
  check_out              date,
  status                 text,
  arrived_at             timestamptz,
  departed_at            timestamptz,
  arrival_due            timestamptz,
  departure_due          timestamptz,
  arrival_numbers        text[],
  departure_numbers      text[],
  arrival_overdue        boolean,
  departure_overdue      boolean
)
language sql
stable
as $fn$
  with stay as (
    select r.*, h.timezone,
           -- The instant the stay became checked_in (a walk-in is inserted
           -- checked_in, so its "before" is empty). The first one: an undone
           -- and repeated check-in does not move the guest's arrival.
           (select min(al.at) from audit_log al
             where al.table_name = 'reservations' and al.row_id = r.id::text
               and al.after->>'status' = 'checked_in'
               and coalesce(al.before->>'status', '') <> 'checked_in') as arrived_at,
           case when r.status = 'checked_out' then
             (select max(al.at) from audit_log al
               where al.table_name = 'reservations' and al.row_id = r.id::text
                 and al.after->>'status' = 'checked_out'
                 and coalesce(al.before->>'status', '') <> 'checked_out')
           end as departed_at
      from reservations r
      join hotels h on h.id = r.hotel_id
     where r.hotel_id = p_hotel_id
       and r.status in ('checked_in', 'checked_out')
  ), due as (
    select s.*,
           -- 24 hours from the actual arrival. With no recorded instant (no
           -- such row exists today) the property's midnight of the arrival
           -- date - never later than the real deadline, so never lenient.
           coalesce(s.arrived_at, s.check_in::timestamp at time zone s.timezone)
             + interval '24 hours' as arrival_due,
           case when s.status = 'checked_out' then
             coalesce(s.departed_at, s.check_out::timestamp at time zone s.timezone)
               + interval '24 hours'
           end as departure_due
      from stay s
  ), person as (
    -- The lead guest, then the companions. A companion arrived and left with
    -- the stay, so both clocks are the stay's.
    select d.id as stay_id, d.guest_id as person_id, false as is_companion from due d
    union all
    select c.reservation_id, c.guest_id, true
      from stay_companions c
      join due d on d.id = c.reservation_id
  ), people as (
    select p.*,
           -- A companion's numbers are their own. The lead's are all the rest:
           -- a filing names the guest it was recorded on, and a join may have
           -- moved the lead to another record since.
           array(select f.reference from form_c_filings f
                  where f.reservation_id = p.stay_id and f.kind = 'arrival'
                    and case when p.is_companion then f.guest_id = p.person_id
                        else not exists (select 1 from stay_companions c
                                          where c.reservation_id = p.stay_id
                                            and c.guest_id = f.guest_id) end
                  order by f.filed_at, f.reference) as arrival_numbers,
           array(select f.reference from form_c_filings f
                  where f.reservation_id = p.stay_id and f.kind = 'departure'
                    and case when p.is_companion then f.guest_id = p.person_id
                        else not exists (select 1 from stay_companions c
                                          where c.reservation_id = p.stay_id
                                            and c.guest_id = f.guest_id) end
                  order by f.filed_at, f.reference) as departure_numbers
      from person p
  )
  select d.id,
         p.person_id,
         p.is_companion,
         g.full_name,
         g.nationality,
         gd.gender,
         gd.date_of_birth,
         gd.id_type,
         -- LEFT JOINed: a foreign guest with no document still owes a filing
         -- and must appear with a blank, not vanish (025).
         gd.id_number,
         gd.passport_issued_on,
         gd.passport_issue_place,
         gd.passport_issue_country,
         gd.passport_expiry,
         gd.visa_number,
         gd.visa_type,
         gd.visa_issued_on,
         gd.visa_issue_place,
         gd.visa_issue_country,
         gd.visa_expiry,
         gd.address_line,
         gd.city,
         gd.country,
         fs.phone_in_india,
         fs.mobile_in_india,
         fs.phone_abroad,
         fs.mobile_abroad,
         g.email::text,
         fs.remarks,
         fs.arrived_from,
         fs.previous_stay,
         fs.purpose,
         fs.purpose_other,
         fs.arrived_in_india_on,
         fs.arrival_port,
         fs.employed_in_india,
         fs.ref_address,
         fs.ref_city,
         fs.ref_state,
         fs.ref_pincode,
         fs.next_destination,
         -- The room held, else the one they left from (086); "-" when none
         -- was ever given (GUE-2: never the long dash).
         coalesce(app.stay_room(d.id), '-'),
         d.adults::int,
         app.stay_recorded(d.id),
         d.children::int,
         d.check_in,
         d.check_out,
         d.status,
         d.arrived_at,
         d.departed_at,
         d.arrival_due,
         d.departure_due,
         p.arrival_numbers,
         p.departure_numbers,
         d.arrival_due < now() and cardinality(p.arrival_numbers) = 0,
         coalesce(d.departure_due < now() and cardinality(p.departure_numbers) = 0, false)
    from due d
    join people p on p.stay_id = d.id
    join guests g on g.id = p.person_id
    left join guest_documents gd on gd.guest_id = g.id
    left join form_iii_stays fs on fs.reservation_id = d.id
         and fs.guest_id is not distinct from (case when p.is_companion then p.person_id end)
   -- A foreigner is anybody not Indian, OCI cardholders included (17(1)).
   where g.nationality <> 'IN'
   -- What still needs doing first, soonest deadline first; then the rest,
   -- newest first; the lead guest above their companions.
   order by (cardinality(p.arrival_numbers) = 0
             or (d.status = 'checked_out' and cardinality(p.departure_numbers) = 0)) desc,
            case when cardinality(p.arrival_numbers) = 0 then d.arrival_due
                 else d.departure_due end asc nulls last,
            d.check_in desc,
            p.is_companion,
            g.full_name
$fn$;

comment on function app.form_iii_people(uuid) is
  'Every foreigner on a stay, each their own row with all of Form III: the '
  'person, the visit, the actual arrival and departure instants (audit log), '
  'both 24-hour deadlines (Rule 17(5) and 17(6)) and their portal numbers. This '
  'system does not file; it names who is owed and keeps the record.';

grant execute on function app.form_iii_people(uuid) to pms_app;


-- =============================================================================
-- 6 · A TEST HOTEL'S CLASSES: 251'S LIST, WITH stay_companions AS TRADING
-- =============================================================================
-- ⚠ 254 may redefine this too; whichever merges last must carry every entry.
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
  ('night_audit_runs', 'trading'), ('form_c_filings', 'trading'),
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
  ('telemetry_requests', 'group'), ('schema_migrations', 'group')
$$;


-- =============================================================================
-- 7 · THE FULL RESET (250)
-- =============================================================================
-- A companion's record has no booking of its own, so 250's `orphans` called
-- every companion in the group an orphan: clearing one hotel would have taken
-- the people on another hotel's stays with it. A person goes when no stay,
-- function or companion's place at another hotel is left. The link goes with
-- the hotel's rows, before reservations; a companion's ID papers go with their
-- guest by cascade, and a guest who is someone's companion elsewhere keeps
-- theirs.
create or replace function owner_reset.orphans(p_hotel uuid)
returns uuid[]
language sql
stable
as $fn$
  select array_agg(g.id)
    from guests g
   where not exists (select 1 from reservations r where r.guest_id = g.id and r.hotel_id <> p_hotel)
     and not exists (select 1 from banquet_events b where b.guest_id = g.id and b.hotel_id <> p_hotel)
     and not exists (select 1 from stay_companions c where c.guest_id = g.id and c.hotel_id <> p_hotel)
$fn$;

create or replace function owner_reset.steps(p_fresh boolean)
returns table (step int, table_name text, where_sql text)
language sql
immutable
as $fn$
  select s.step::int, s.e ->> 0, s.e ->> 1
    from (
      select e, o as step from jsonb_array_elements($list$[
        ["vat_bills",                 "hotel_id = $1"],
        ["guest_food_orders",         "hotel_id = $1"],
        ["pos_order_tenders",         "order_id in (select id from pos_orders where hotel_id = $1)"],
        ["pos_order_lines",           "hotel_id = $1"],
        ["pos_tender_changes",        "hotel_id = $1"],
        ["pos_requests",              "hotel_id = $1"],
        ["pos_orders",                "hotel_id = $1"],
        ["pos_tickets",               "hotel_id = $1"],
        ["pos_cash_movements",        "hotel_id = $1"],
        ["pos_denominations",         "day_end_id in (select id from pos_day_ends where hotel_id = $1)"],
        ["pos_day_ends",              "hotel_id = $1"],
        ["banquet_event_packages",    "hotel_id = $1"],
        ["cashier_float_claims",      "closed_shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_denominations",     "shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_movements",         "hotel_id = $1"],
        ["cashier_shifts",            "hotel_id = $1"],
        ["cash_deposit_notes",        "hotel_id = $1"],
        ["cash_deposits",             "hotel_id = $1"],
        ["company_payments",          "hotel_id = $1"],
        ["spa_appointments",          "hotel_id = $1"],
        ["laundry_dockets",           "hotel_id = $1"],
        ["table_bookings",            "hotel_id = $1"],
        ["guest_id_photo_views",      "hotel_id = $1"],
        ["guest_id_photos",           "hotel_id = $1"],
        ["guest_digilocker_attempts", "hotel_id = $1"],
        ["guest_links",               "hotel_id = $1"],
        ["form_c_filings",            "hotel_id = $1"],
        ["form_iii_stays",            "hotel_id = $1"],
        ["stay_companions",           "hotel_id = $1"],
        ["closed_day_corrections",    "hotel_id = $1"],
        ["invoices",                  "hotel_id = $1"],
        ["refunds",                   "hotel_id = $1"],
        ["payments",                  "hotel_id = $1"],
        ["loyalty_points",            "hotel_id = $1"],
        ["folio_postings",            "hotel_id = $1"],
        ["folios",                    "hotel_id = $1"],
        ["guest_documents",           "guest_id in (select guest_id from reservations where hotel_id = $1) and not exists (select 1 from reservations r where r.guest_id = guest_documents.guest_id and r.hotel_id <> $1) and not exists (select 1 from stay_companions c where c.guest_id = guest_documents.guest_id and c.hotel_id <> $1)"],
        ["housekeeping_assignments",  "hotel_id = $1"],
        ["room_assignments",          "hotel_id = $1"],
        ["room_status_log",           "hotel_id = $1"],
        ["work_order_costs",          "hotel_id = $1"],
        ["work_orders",               "hotel_id = $1"],
        ["wake_up_calls",             "hotel_id = $1"],
        ["lost_items",                "hotel_id = $1"],
        ["room_blocks",               "hotel_id = $1"],
        ["banquet_events",            "hotel_id = $1"],
        ["reservations",              "hotel_id = $1"],
        ["reservation_groups",        "(lead_hotel_id is null or lead_hotel_id = $1) and not exists (select 1 from reservations r where r.group_id = reservation_groups.id and r.hotel_id <> $1) and not exists (select 1 from folios f where f.group_id = reservation_groups.id and f.hotel_id <> $1)"],
        ["night_audit_runs",          "hotel_id = $1"],
        ["bar_request_lines",         "hotel_id = $1"],
        ["bar_requests",              "hotel_id = $1"],
        ["bar_closed_days",           "hotel_id = $1"],
        ["supplier_reversals",        "hotel_id = $1"],
        ["supplier_payments",         "hotel_id = $1"],
        ["supplier_credit_notes",     "hotel_id = $1"],
        ["supplier_bills",            "hotel_id = $1"],
        ["bar_purchase_lines",        "hotel_id = $1"],
        ["stock_count_lines",         "hotel_id = $1"],
        ["stock_movements",           "hotel_id = $1"],
        ["bar_purchases",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
      union all
      select e, 1000 + o from jsonb_array_elements($list$[
        ["equipment_moves",           "hotel_id = $1"],
        ["equipment_history",         "hotel_id = $1"],
        ["purchase_request_lines",    "hotel_id = $1"],
        ["purchase_requests",         "hotel_id = $1"],
        ["approvals",                 "hotel_id = $1"],
        ["crs_bookings",              "hotel_id = $1"],
        ["channel_bookings",          "hotel_id = $1"],
        ["messages_sent",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
       where p_fresh
    ) s
   order by s.step
$fn$;
