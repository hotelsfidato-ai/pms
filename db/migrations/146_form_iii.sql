-- =============================================================================
-- 146 · Form III: every particular, both 24-hour clocks (D27-25)
-- =============================================================================
-- Form C died with the Foreigners Act 1946. Since 1 September 2025 the
-- Immigration and Foreigners Act 2025 s.8 and Rule 17 of its Rules (G.S.R.
-- 596(E)) make the keeper of accommodation:
--
--   17(1)  take every foreigner's particulars and signature on ARRIVAL, and at
--          DEPARTURE the date, time and address they go to; keep them
--          electronically for at least a year
--   17(5)  send Form III to the portal within 24 hours of ARRIVAL
--   17(6)  send the departure within 24 hours of DEPARTURE
--
-- 025 measured one clock from the check-in DATE and had no departure at all.
-- The actual moments are already recorded: the audit log holds the instant a
-- stay became checked_in and checked_out (the night-audit report reads them
-- the same way). So both deadlines are 24 hours from what happened.
--
-- The owner, 27 September: the system records every box the portal asks
-- (indianfrro.gov.in/formIII - read from its public page code; it has no
-- upload and no API, so the desk still files by hand); the photograph is taken
-- on the portal and not kept here (D21-11); the guest signs a printed card.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The person: what the portal asks beyond 013's passport and visa
-- -----------------------------------------------------------------------------
alter table guest_documents
  add column if not exists gender                 text,
  add column if not exists date_of_birth          date,
  add column if not exists passport_issued_on     date,
  add column if not exists passport_issue_place   text,
  add column if not exists passport_issue_country text,
  add column if not exists visa_type              text,
  add column if not exists visa_issued_on         date,
  add column if not exists visa_issue_place       text,
  add column if not exists visa_issue_country     text;

-- The portal's own three (its gender list, read 27 September).
alter table guest_documents drop constraint if exists gd_gender_valid;
alter table guest_documents add constraint gd_gender_valid
  check (gender is null or gender in ('female', 'male', 'transgender'));


-- -----------------------------------------------------------------------------
-- The visit: what Form III asks about THIS stay
-- -----------------------------------------------------------------------------
-- Per stay, not per person: a guest who comes back next year arrives from
-- somewhere else, for another reason, and goes somewhere else.
create table if not exists form_iii_stays (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references hotels(id) on delete cascade,
  -- No cascade: the record is kept a year (17(1)), so a booking holding one
  -- cannot be deleted out from under it - the same as form_c_filings.
  reservation_id      uuid not null unique references reservations(id),

  arrived_from        text,
  previous_stay       text,
  purpose             text,
  purpose_other       text,
  phone_in_india      text,
  arrived_in_india_on date,
  arrival_port        text,
  employed_in_india   boolean,
  ref_address         text,
  ref_city            text,
  ref_state           text,
  ref_pincode         text,
  remarks             text,
  -- Asked at check-out (the owner, 27 September), where 17(1) asks it.
  next_destination    text,

  updated_by          uuid references staff(id),
  updated_at          timestamptz not null default now(),

  -- Form III's own seven.
  constraint form_iii_purpose_valid check (purpose is null or purpose in
    ('tourism', 'business', 'employment', 'medical', 'student', 'conference', 'others'))
);

comment on table form_iii_stays is
  'What Form III asks about one visit: arrived from, purpose, previous and '
  'next place of stay, the reference address in India. The person''s own '
  'particulars are guest_documents; the filings are form_c_filings.';

alter table form_iii_stays enable row level security;
alter table form_iii_stays force  row level security;
drop policy if exists hotel_isolation on form_iii_stays;
create policy hotel_isolation on form_iii_stays
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- Kept a year at least; corrected, never removed.
revoke delete on form_iii_stays from pms_app;

drop trigger if exists form_iii_stays_touch on form_iii_stays;
create trigger form_iii_stays_touch before update on form_iii_stays
  for each row execute function app.touch_updated_at();

drop trigger if exists form_iii_stays_audit on form_iii_stays;
create trigger form_iii_stays_audit
  after insert or update or delete on form_iii_stays
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- Filings: arrival AND departure, and one number per person
-- -----------------------------------------------------------------------------
-- Each foreigner in the room owes their own Form III, and the booking knows
-- only its lead guest (the owner, 27 September: warn, and take a number per
-- person). So a stay holds several numbers of each kind - never one twice.
alter table form_c_filings
  add column if not exists kind text not null default 'arrival';
alter table form_c_filings drop constraint if exists form_c_filings_kind_valid;
alter table form_c_filings add constraint form_c_filings_kind_valid
  check (kind in ('arrival', 'departure'));

alter table form_c_filings drop constraint if exists form_c_filings_reservation_id_key;
create unique index if not exists form_c_filings_one_number
  on form_c_filings (reservation_id, kind, reference);


-- -----------------------------------------------------------------------------
-- The register: every foreign stay, every field, both clocks
-- -----------------------------------------------------------------------------
-- A new function rather than a new return type for app.form_c_due, which a
-- replay of 025 would then fail to recreate (MEMORY 317). The old one read
-- the wrong clock and nothing calls it after this migration.
drop function if exists app.form_c_due(uuid);

create or replace function app.form_iii(p_hotel_id uuid)
returns table (
  reservation_id         uuid,
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
           end as departed_at,
           array(select f.reference from form_c_filings f
                  where f.reservation_id = r.id and f.kind = 'arrival'
                  order by f.filed_at, f.reference) as arrival_numbers,
           array(select f.reference from form_c_filings f
                  where f.reservation_id = r.id and f.kind = 'departure'
                  order by f.filed_at, f.reference) as departure_numbers
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
  )
  select d.id,
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
         d.children::int,
         d.check_in,
         d.check_out,
         d.status,
         d.arrived_at,
         d.departed_at,
         d.arrival_due,
         d.departure_due,
         d.arrival_numbers,
         d.departure_numbers,
         d.arrival_due < now() and cardinality(d.arrival_numbers) = 0,
         coalesce(d.departure_due < now() and cardinality(d.departure_numbers) = 0, false)
    from due d
    join guests g on g.id = d.guest_id
    left join guest_documents gd on gd.guest_id = g.id
    left join form_iii_stays fs on fs.reservation_id = d.id
   -- A foreigner is anybody not Indian, OCI cardholders included (17(1)).
   where g.nationality <> 'IN'
   -- What still needs doing first, soonest deadline first; then the rest,
   -- newest first.
   order by (cardinality(d.arrival_numbers) = 0
             or (d.status = 'checked_out' and cardinality(d.departure_numbers) = 0)) desc,
            case when cardinality(d.arrival_numbers) = 0 then d.arrival_due
                 else d.departure_due end asc nulls last,
            d.check_in desc
$fn$;

comment on function app.form_iii(uuid) is
  'Every foreign stay with all of Form III: the person, the visit, the actual '
  'arrival and departure instants (audit log), both 24-hour deadlines (Rule '
  '17(5) and 17(6)) and the portal numbers recorded. This system does not '
  'file; it names who is owed and keeps the record.';

grant execute on function app.form_iii(uuid) to pms_app;
