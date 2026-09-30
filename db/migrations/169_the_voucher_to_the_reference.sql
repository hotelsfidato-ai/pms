-- =============================================================================
-- 169 — the voucher, refined to the owner's reference (D27-215, D27-216)
-- =============================================================================
-- The owner, 1 October: the booking voucher gains what their reference has -
-- the hotel's bank details, a payment line, the group's office details in the
-- footer, the hotel's reservations contact, who booked, the hotel's house
-- policies, and extra guests under a room's line. All additive, re-runnable,
-- and nothing already typed is changed.
--
--   1  the hotel's reservations contact       one more field of its profile (168)
--   2  the hotel's house policies             a list on its row; four to begin with
--   3  the hotel's bank details               their own table, for who manages it
--   4  the group's office details             beside its name and logo (148)
--   5  the voucher's facts                    app.guest_voucher (168), keys ADDED
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · the hotel's reservations contact
-- -----------------------------------------------------------------------------
-- The person a guest asks for. Printed on the voucher as "Contact"; NULL prints
-- nothing. Written through the hotel's row: app.manages_hotel (168), audited.
-- -----------------------------------------------------------------------------
alter table hotels add column if not exists reservations_contact text;

comment on column hotels.reservations_contact is
  'The hotel''s reservations contact person, printed on the voucher as "Contact" (D27-215).';


-- -----------------------------------------------------------------------------
-- 2 · the hotel's house policies
-- -----------------------------------------------------------------------------
-- Printed on the voucher after the booking's cancellation terms and the
-- check-in and check-out line, in this order. The owner: "starting with the
-- reference's four lines" - so every hotel that has NEVER had a list gets the
-- four, and a new hotel gets them by the column's default.
--
-- ⚠ ONLY A NULL IS FILLED. The column is made NOT NULL after the fill, so a
-- hotel that EMPTIES its list holds '{}' and a replay leaves it empty: nothing
-- a manager removed comes back.
-- -----------------------------------------------------------------------------
alter table hotels add column if not exists house_policies text[];

update hotels
   set house_policies = array[
         'Guests must present government photo identity at check in - driving licence, voter ID, Aadhaar or passport.',
         'A valid credit card may be required to guarantee incidental charges.',
         'Special requests are subject to availability at check in.',
         'Please share your company GST number at check in if the stay is billed to a company.']
 where house_policies is null;

alter table hotels alter column house_policies set default array[
  'Guests must present government photo identity at check in - driving licence, voter ID, Aadhaar or passport.',
  'A valid credit card may be required to guarantee incidental charges.',
  'Special requests are subject to availability at check in.',
  'Please share your company GST number at check in if the stay is billed to a company.'];
alter table hotels alter column house_policies set not null;

/* At most eight lines of 1 to 200 characters: the voucher is one A4 page.
   A function, because a check cannot look inside an array by itself. */
create or replace function app.house_policies_fit(p text[])
returns boolean
language sql
immutable
as $$
  select cardinality(p) <= 8
     and not exists (select 1 from unnest(p) x
                      where x is null or char_length(btrim(x)) < 1 or char_length(x) > 200)
$$;

alter table hotels drop constraint if exists hotels_house_policies_fit;
alter table hotels add constraint hotels_house_policies_fit
  check (app.house_policies_fit(house_policies));

comment on column hotels.house_policies is
  'The hotel''s house policies, in order, printed on the voucher after the '
  'booking''s own terms (D27-215). At most 8 lines of 200 characters.';


-- -----------------------------------------------------------------------------
-- 3 · the hotel's bank details
-- -----------------------------------------------------------------------------
-- Printed on the voucher when set; the block is left out when not (lifting
-- D27-172's "no bank details until they exist in Settings"). Their own table:
-- the desk reads a hotel's row all day and has no use for an account number,
-- so these are READ as well as written only by whoever manages THAT hotel -
-- its owner, GM or Admin, or a group administrator (app.manages_hotel). The
-- voucher reads them through its definer (section 5).
--
-- Every change is recorded (app.write_audit), and that record is what the
-- group owner's bell reads (D27-216): a write through any door shows there.
-- -----------------------------------------------------------------------------
create table if not exists hotel_bank_details (
  hotel_id        uuid primary key references hotels(id) on delete cascade,
  account_name    text not null,
  account_number  text not null,
  bank_name       text not null,
  branch          text,
  ifsc            text not null,
  upi_id          text,
  changed_by      uuid references staff(id),
  changed_at      timestamptz not null default now(),

  constraint hotel_bank_details_words check (
    char_length(btrim(account_name)) between 1 and 100
    and char_length(btrim(bank_name)) between 1 and 100
    and (branch is null or char_length(btrim(branch)) between 1 and 100)),
  constraint hotel_bank_details_account check (account_number ~ '^[0-9]{9,18}$'),
  constraint hotel_bank_details_ifsc    check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint hotel_bank_details_upi     check (
    upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]+$')
);

comment on table hotel_bank_details is
  'A hotel''s bank details (D27-215): printed on the booking voucher when set. '
  'Read and written by whoever manages that hotel; every change audited, and '
  'told to the group owner''s bell (D27-216).';

alter table hotel_bank_details enable row level security;
alter table hotel_bank_details force  row level security;

drop policy if exists hotel_bank_details_manage on hotel_bank_details;
create policy hotel_bank_details_manage on hotel_bank_details
  for all
  using      ( app.manages_hotel(hotel_id) )
  with check ( app.manages_hotel(hotel_id) );

grant select, insert, update, delete on hotel_bank_details to pms_app;

drop trigger if exists hotel_bank_details_audit on hotel_bank_details;
create trigger hotel_bank_details_audit after insert or update or delete on hotel_bank_details
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 4 · the group's office details
-- -----------------------------------------------------------------------------
-- The voucher's footer is the GROUP's office: its name (148), address, phone,
-- email, website and GSTIN, and its Instagram address under the policies.
-- Typed once in Settings by whoever changes the group's name today
-- (app.sets_group_settings); audited already. NULL prints nothing - and with
-- none of them typed the voucher keeps the footer it has.
-- -----------------------------------------------------------------------------
alter table group_settings add column if not exists office_address text;
alter table group_settings add column if not exists phone          text;
alter table group_settings add column if not exists email          text;
alter table group_settings add column if not exists website        text;
alter table group_settings add column if not exists gstin          text;
alter table group_settings add column if not exists instagram      text;

alter table group_settings drop constraint if exists group_settings_office_fit;
alter table group_settings add constraint group_settings_office_fit check (
  (office_address is null or char_length(btrim(office_address)) between 1 and 200)
  and (phone     is null or char_length(btrim(phone))     between 1 and 40)
  and (email     is null or char_length(btrim(email))     between 3 and 120)
  and (website   is null or char_length(btrim(website))   between 3 and 120)
  and (instagram is null or char_length(btrim(instagram)) between 1 and 80)
  and (gstin     is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'));


-- -----------------------------------------------------------------------------
-- 5 · the voucher's facts
-- -----------------------------------------------------------------------------
-- ⚠ THIS IS 168's FUNCTION WITH LINES ADDED AND NONE CHANGED: the signature,
-- the return type and every line 168 has are here as they were (MEMORY 317),
-- and api/test/modules/guest-messaging/viewVoucher.test.ts fails if an old line
-- is missing or out of order. Every key the voucher had means what it meant.
--
-- ADDED: contact, bookedBy, payment {received, billTo}, bank, group,
-- housePolicies; and in each room extraAdults and extraChildren. A later change
-- re-creates the function in its own migration, starting from THIS text.
-- -----------------------------------------------------------------------------
create or replace function app.guest_voucher(p_reservation uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with l as (
    select r.* from reservations r where r.id = p_reservation and r.status = 'confirmed'
  ),
  made as (
    -- Who made the booking: the audit's own record of the row being made (016).
    -- reservations.created_by is never written, so this is the record there is.
    select a.actor
      from audit_log a
     where a.table_name = 'reservations' and a.row_id = p_reservation::text
       and a.action = 'INSERT'
     order by a.at
     limit 1
  ),
  confirmed as (
    -- Who made it confirmed, and when: the audit's own record of the change
    -- (a booking made confirmed, or confirmed after waiting for the hotel).
    select a.actor, a.at
      from audit_log a
     where a.table_name = 'reservations' and a.row_id = p_reservation::text
       and a.after->>'status' = 'confirmed'
       and coalesce(a.before->>'status', '') <> 'confirmed'
     order by a.at desc
     limit 1
  )
  select jsonb_build_object(
    'reference', l.reference,
    'bookedOn', (l.created_at at time zone h.timezone)::date,
    'checkIn', l.check_in,
    'checkOut', l.check_out,
    'nights', l.check_out - l.check_in,
    'hotel', jsonb_build_object(
      'name', h.name, 'address', h.address_line, 'city', h.city, 'state', h.state,
      'phone', h.phone, 'email', h.email, 'gstin', h.gstin,
      'checkInTime', to_char(h.check_in_time, 'HH24:MI'),
      'checkOutTime', to_char(h.check_out_time, 'HH24:MI')),
    'groupName', (select gs.name from group_settings gs),
    -- A PNG only: the PDF draws PNG, and an SVG logo prints the name instead.
    'logoPng', coalesce(
                 (select encode(hl.logo, 'base64') from hotel_logos hl
                   where hl.hotel_id = l.hotel_id and hl.logo_type = 'image/png'),
                 (select encode(gs.logo, 'base64') from group_settings gs
                   where gs.logo_type = 'image/png')),
    'guest', (select jsonb_build_object('name', g.full_name, 'email', g.email, 'phone', g.phone)
                from guests g where g.id = l.guest_id),
    'company', (select c.name from companies c where c.id = l.company_id),
    'rooms', (
      select jsonb_agg(jsonb_build_object(
               'roomType', rt.name,
               -- The code with its words, as every screen says it (D27-164),
               -- from the one list the database keeps (inventory's pricing.ts
               -- reads it the same way); the bare code where it has no row.
               'mealPlan', coalesce((select mp.code || ' · ' || mp.includes
                                       from meal_plans mp where mp.code = r.meal_plan),
                                    r.meal_plan),
               'adults', r.adults, 'children', r.children,
               'nights', r.check_out - r.check_in,
               'rate', r.agreed_rate,
               'complimentary', r.is_complimentary,
               -- added by 169: the guests past what the room's price covers, by the
               -- tariff's own count (app.tariff_for, 162) - never a second rule here.
               'extraAdults', (select t.extra_adults from app.tariff_for(
                                  r.room_type_id, coalesce(r.meal_plan, 'EP'), r.check_in,
                                  r.adults::int, r.children::int) t),
               'extraChildren', (select t.extra_children from app.tariff_for(
                                  r.room_type_id, coalesce(r.meal_plan, 'EP'), r.check_in,
                                  r.adults::int, r.children::int) t),
               'gstRate', case when r.is_complimentary then null
                               else app.gst_rate_or_null(r.hotel_id, 'room', r.agreed_rate) end)
             order by r.created_at, r.reference)
        from reservations r
        join room_types rt on rt.id = r.room_type_id
       where coalesce(r.group_id, r.id) = coalesce(l.group_id, l.id)
         and r.status in ('confirmed', 'checked_in')),
    'terms', jsonb_build_object(
      'name', l.cancel_terms, 'freeUntilHours', l.cancel_free_until_hours,
      'cancelBasis', l.cancel_basis, 'cancelPercent', l.cancel_percent,
      'cancelAmount', l.cancel_amount, 'noShowBasis', l.no_show_basis,
      'noShowPercent', l.no_show_percent, 'noShowAmount', l.no_show_amount),
    -- ---- added by 169 (D27-215); every key above and below is as 168 has it ----
    'contact', h.reservations_contact,
    -- A person's name. A booking a machine made - the channel manager's or the
    -- CRS's own account - says where it came from. Nothing where no record is kept.
    'bookedBy', (select case
                          when m.actor in (select ch.run_as from channel_hotels ch where ch.run_as is not null
                                           union all
                                           select cr.run_as from crs_hotels cr where cr.run_as is not null)
                            then (select bs.name from booking_sources bs where bs.id = l.booking_source_id)
                          else (select s.full_name from staff s where s.id = m.actor)
                        end
                   from made m),
    -- What the booking's bills have RECEIVED, by the bill's own definition of
    -- "paid" (finance/folios.ts): payments, leaving out a reversed payment and
    -- its reversal - on the folios of every standing room of the group, and on
    -- the group's own folio. Read here, with the rest, so the voucher's figures
    -- are one read; and whom the lead's bill is made out to.
    'payment', jsonb_build_object(
      'received', (select coalesce(-sum(fp.amount), 0)
                     from folio_postings fp
                     join folios f on f.id = fp.folio_id
                    where fp.category = 'payment'
                      and fp.reverses_id is null
                      and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
                      and (f.reservation_id in (
                             select r.id from reservations r
                              where coalesce(r.group_id, r.id) = coalesce(l.group_id, l.id)
                                and r.status in ('confirmed', 'checked_in'))
                           or (l.group_id is not null and f.group_id = l.group_id))),
      'billTo', (select f.bill_to from folios f
                  where f.reservation_id = l.id order by f.opened_at limit 1)),
    -- The hotel's bank details, or null: the voucher leaves the block out.
    'bank', (select jsonb_build_object(
                      'accountName', b.account_name, 'accountNumber', b.account_number,
                      'bankName', b.bank_name, 'branch', b.branch, 'ifsc', b.ifsc, 'upi', b.upi_id)
               from hotel_bank_details b where b.hotel_id = l.hotel_id),
    -- The group's office details, for the footer; each null until typed.
    'group', (select jsonb_build_object(
                       'name', gs.name, 'address', gs.office_address, 'phone', gs.phone,
                       'email', gs.email, 'website', gs.website, 'gstin', gs.gstin,
                       'instagram', gs.instagram)
                from group_settings gs),
    'housePolicies', to_jsonb(h.house_policies),
    'confirmedBy', (select s.full_name from confirmed c join staff s on s.id = c.actor),
    'confirmedAt', (select to_char(c.at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI')
                      from confirmed c)
  )
  from l join hotels h on h.id = l.hotel_id;
$fn$;
