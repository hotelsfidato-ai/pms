-- =============================================================================
-- 158 · The code to the booking's phone; a day unlocked; what a guest sends
--       before they arrive (D27-105, D27-169)
-- =============================================================================
-- Three changes to the guest's own door (114, 121, 141), none of which changes
-- the signature or the return type of a function an earlier migration makes
-- (MEMORY 317) - every deploy replays from 001:
--
--   · THE CODE GOES STRAIGHT TO THE BOOKING'S PHONE (D27-105). The guest no
--     longer types a number that the booking already carries: opening the link
--     asks for the code, and it goes to that number, whose last digits the page
--     shows (none on a room card, D21-14). `app.guest_code_make(text)` is a NEW
--     signature, so 121's two-argument one is dropped here, not replaced: a
--     replay makes it at 121 and this file takes it away again. A stay with no
--     mobile number answers a row with no code, so the page can say "Ask the
--     desk" instead of waiting for a message that will never come.
--
--   · A DAY UNLOCKED (D27-169, replacing D21-92's hour). A guest who answered
--     the code comes back to the page the same day without another code.
--     `app.guest_code_answer`: its body only.
--
--   · WHAT THE GUEST SENDS (D27-169). The arrival time, special requests, the
--     nationality, and for a foreign guest Form III's own questions about the
--     person and the visit (147) - not its remarks or the next destination,
--     which stay with the desk. All still WAIT for a clerk (D21-8); the staff
--     route writes them where each belongs when the clerk confirms.
--     `app.guest_details_submit`: its body only, the same arguments.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The code, to the number the stay carries
-- -----------------------------------------------------------------------------
drop function if exists app.guest_code_make(text, text);

create or replace function app.guest_code_make(p_token_hash text)
returns table (code text, sent_to text, phone text, reservation_id uuid, reference text,
               guest_name text, hotel_id uuid, hotel_code text, hotel_name text,
               room_card boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link  uuid;
  v_stay  uuid;
  v_room  boolean;
  v_phone text;
  v_code  text;
begin
  select s.link_id, s.reservation_id, s.room_id is not null,
         nullif(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), '')
    into v_link, v_stay, v_room, v_phone
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null then
    return;                                     -- nothing, and nothing said
  end if;

  -- A stay with no number to send to: a row with no code, so the door can say
  -- "Ask the desk". Nothing is issued - a code nobody can receive is a code
  -- that only burns the guest's last one.
  if v_phone is null or length(v_phone) < 10 then
    return query
      select null::text, null::text, null::text, r.id, r.reference, g.full_name,
             h.id, h.code, h.name, v_room
        from reservations r
        join guests g on g.id = r.guest_id
        join hotels h on h.id = r.hotel_id
       where r.id = v_stay;
    return;
  end if;

  v_code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  update guest_link_codes set consumed_at = now()
   where link_id = v_link and consumed_at is null;

  insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
  values (v_link, v_stay, encode(digest(v_code, 'sha256'), 'hex'),
          '…' || right(v_phone, 4),
          now() + interval '10 minutes');

  -- ⚠ `phone` is the booking's WHOLE number (OCI-2): the door hands it to the
  -- sender and to nothing else. `sent_to` is the masked one, for the record.
  return query
    select v_code, '…' || right(v_phone, 4), g.phone, r.id, r.reference, g.full_name,
           h.id, h.code, h.name, v_room
      from reservations r
      join guests g on g.id = r.guest_id
      join hotels h on h.id = r.hotel_id
     where r.id = v_stay;
end
$fn$;

comment on function app.guest_code_make(text) is
  'A six-digit code for the phone THE STAY carries (D27-105): no number is typed. '
  'A stay with no mobile number answers a row with no code, and nothing is issued.';

revoke all on function app.guest_code_make(text) from public;
grant execute on function app.guest_code_make(text) to pms_app;

-- -----------------------------------------------------------------------------
-- 2 · A day unlocked (D27-169)
-- -----------------------------------------------------------------------------
-- 121's function, the same arguments and return type; only the unlock's life.
create or replace function app.guest_code_answer(
  p_token_hash text, p_code text, p_unlock_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid;
  v_stay uuid;
  v_id   uuid;
  v_ok   boolean := false;
begin
  if coalesce(length(p_unlock_hash), 0) <> 64 then
    return false;
  end if;

  select s.link_id, s.reservation_id into v_link, v_stay
    from app.guest_link_stay(p_token_hash) s;
  if v_link is null or v_stay is null then
    return false;
  end if;

  select c.id,
         c.code_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex')
    into v_id, v_ok
    from guest_link_codes c
   where c.link_id = v_link
     and c.reservation_id = v_stay
     and c.consumed_at is null
     and c.expires_at > now()
     and c.attempts < 5
   order by c.created_at desc
   limit 1;

  if v_id is null then
    return false;                               -- none live, or five wrong
  end if;

  update guest_link_codes
     set attempts = attempts + 1,
         consumed_at = case when v_ok then now() else consumed_at end
   where id = v_id;

  if v_ok then
    update guest_links set verified_at = now() where id = v_link;
    -- A DAY - the owner, D27-169 (it was an hour, D21-92): a guest who comes
    -- back to the page the same day is not asked for another code. Still THIS
    -- phone and this stay only (D21-6).
    insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
    values (v_link, v_stay, p_unlock_hash, now() + interval '24 hours');
  end if;

  return v_ok;
end
$fn$;

-- -----------------------------------------------------------------------------
-- 3 · What the guest sends, waiting for a clerk (D27-169)
-- -----------------------------------------------------------------------------
-- The same names as where each is written when the clerk confirms:
-- reservations.expected_arrival, guests.nationality, guest_documents (147's
-- person) and form_iii_stays (147's visit). Special requests go into the
-- booking's notes ("Guest asked online: …").
alter table guest_detail_submissions
  add column if not exists expected_arrival       time,
  add column if not exists special_requests       text,
  add column if not exists nationality            text,
  add column if not exists gender                 text,
  add column if not exists date_of_birth          date,
  add column if not exists passport_issued_on     date,
  add column if not exists passport_issue_place   text,
  add column if not exists passport_issue_country text,
  add column if not exists visa_type              text,
  add column if not exists visa_issued_on         date,
  add column if not exists visa_issue_place       text,
  add column if not exists visa_issue_country     text,
  add column if not exists arrived_from           text,
  add column if not exists previous_stay          text,
  add column if not exists purpose                text,
  add column if not exists purpose_other          text,
  add column if not exists arrived_in_india_on    date,
  add column if not exists arrival_port           text,
  add column if not exists phone_in_india         text,
  add column if not exists mobile_in_india        text,
  add column if not exists phone_abroad           text,
  add column if not exists mobile_abroad          text,
  add column if not exists employed_in_india      boolean,
  add column if not exists ref_address            text,
  add column if not exists ref_city               text,
  add column if not exists ref_state              text,
  add column if not exists ref_pincode            text;

-- Form III's own lists (147), so what the clerk confirms is written as it is.
alter table guest_detail_submissions drop constraint if exists gds_gender_valid;
alter table guest_detail_submissions add constraint gds_gender_valid
  check (gender is null or gender in ('female', 'male', 'transgender'));
alter table guest_detail_submissions drop constraint if exists gds_purpose_valid;
alter table guest_detail_submissions add constraint gds_purpose_valid check (purpose is null or purpose in
  ('tourism', 'business', 'employment', 'medical', 'student', 'conference', 'others'));
alter table guest_detail_submissions drop constraint if exists gds_requests_short;
alter table guest_detail_submissions add constraint gds_requests_short
  check (special_requests is null or length(special_requests) <= 500);

-- 141's function, the same arguments and return type (MEMORY 317); the new
-- fields beside the old, and the offers' yes exactly as 141 records it.
create or replace function app.guest_details_submit(
  p_token_hash text, p_unlock_hash text, p_details jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null then
    return false;
  end if;

  insert into guest_detail_submissions
    (hotel_id, reservation_id, guest_id, id_type, id_number,
     passport_expiry, visa_number, visa_expiry, address_line, city, country,
     expected_arrival, special_requests, nationality,
     gender, date_of_birth, passport_issued_on, passport_issue_place, passport_issue_country,
     visa_type, visa_issued_on, visa_issue_place, visa_issue_country,
     arrived_from, previous_stay, purpose, purpose_other, arrived_in_india_on, arrival_port,
     phone_in_india, mobile_in_india, phone_abroad, mobile_abroad, employed_in_india,
     ref_address, ref_city, ref_state, ref_pincode)
  values
    (v.hotel_id, v.reservation_id, v.guest_id,
     p_details->>'idType', trim(p_details->>'idNumber'),
     nullif(p_details->>'passportExpiry', '')::date,
     nullif(trim(p_details->>'visaNumber'), ''),
     nullif(p_details->>'visaExpiry', '')::date,
     nullif(trim(p_details->>'addressLine'), ''),
     nullif(trim(p_details->>'city'), ''),
     nullif(trim(p_details->>'country'), ''),
     nullif(p_details->>'expectedArrival', '')::time,
     nullif(trim(p_details->>'specialRequests'), ''),
     upper(nullif(trim(p_details->>'nationality'), '')),
     nullif(p_details->>'gender', ''),
     nullif(p_details->>'dateOfBirth', '')::date,
     nullif(p_details->>'passportIssuedOn', '')::date,
     nullif(trim(p_details->>'passportIssuePlace'), ''),
     nullif(trim(p_details->>'passportIssueCountry'), ''),
     nullif(trim(p_details->>'visaType'), ''),
     nullif(p_details->>'visaIssuedOn', '')::date,
     nullif(trim(p_details->>'visaIssuePlace'), ''),
     nullif(trim(p_details->>'visaIssueCountry'), ''),
     nullif(trim(p_details->>'arrivedFrom'), ''),
     nullif(trim(p_details->>'previousStay'), ''),
     nullif(p_details->>'purpose', ''),
     nullif(trim(p_details->>'purposeOther'), ''),
     nullif(p_details->>'arrivedInIndiaOn', '')::date,
     nullif(trim(p_details->>'arrivalPort'), ''),
     nullif(trim(p_details->>'phoneInIndia'), ''),
     nullif(trim(p_details->>'mobileInIndia'), ''),
     nullif(trim(p_details->>'phoneAbroad'), ''),
     nullif(trim(p_details->>'mobileAbroad'), ''),
     (p_details->>'employedInIndia')::boolean,
     nullif(trim(p_details->>'refAddress'), ''),
     nullif(trim(p_details->>'refCity'), ''),
     nullif(trim(p_details->>'refState'), ''),
     nullif(trim(p_details->>'refPincode'), ''))
  on conflict (reservation_id) where status = 'waiting' do update set
     id_type = excluded.id_type, id_number = excluded.id_number,
     passport_expiry = excluded.passport_expiry,
     visa_number = excluded.visa_number, visa_expiry = excluded.visa_expiry,
     address_line = excluded.address_line, city = excluded.city,
     country = excluded.country,
     expected_arrival = excluded.expected_arrival,
     special_requests = excluded.special_requests,
     nationality = excluded.nationality,
     gender = excluded.gender, date_of_birth = excluded.date_of_birth,
     passport_issued_on = excluded.passport_issued_on,
     passport_issue_place = excluded.passport_issue_place,
     passport_issue_country = excluded.passport_issue_country,
     visa_type = excluded.visa_type, visa_issued_on = excluded.visa_issued_on,
     visa_issue_place = excluded.visa_issue_place,
     visa_issue_country = excluded.visa_issue_country,
     arrived_from = excluded.arrived_from, previous_stay = excluded.previous_stay,
     purpose = excluded.purpose, purpose_other = excluded.purpose_other,
     arrived_in_india_on = excluded.arrived_in_india_on,
     arrival_port = excluded.arrival_port,
     phone_in_india = excluded.phone_in_india, mobile_in_india = excluded.mobile_in_india,
     phone_abroad = excluded.phone_abroad, mobile_abroad = excluded.mobile_abroad,
     employed_in_india = excluded.employed_in_india,
     ref_address = excluded.ref_address, ref_city = excluded.ref_city,
     ref_state = excluded.ref_state, ref_pincode = excluded.ref_pincode,
     submitted_at = now();

  if p_details->>'offersAgreed' = 'true' then
    perform app.record_offers_yes(g.phone, g.email::text)
       from guests g where g.id = v.guest_id;
  end if;

  return true;
end
$fn$;

-- -----------------------------------------------------------------------------
-- 4 · The voucher's facts (D27-171, D27-172)
-- -----------------------------------------------------------------------------
-- The booking voucher, in the CRS's design, is the PMS's own confirmation,
-- sent once (D27-35) from the CRS's mailbox as a PDF. The sweep sends it with
-- nobody signed in, and `reservations`, `guests` and `hotels` are row-secured,
-- so it reads the booking through this one definer - the shape 126 gave the
-- sweep's other ways in. Facts only: the figures are worked out by the one
-- function that draws them (api/src/modules/guest-messaging/voucherDocument.ts)
-- from the nightly rate the audit posts and the GST rate THIS database gives
-- for that rate (app.gst_rate_or_null, 067) - null where no rule is set, so
-- the voucher prints a dash and never a total nobody agreed to (D27-172).
--
-- One voucher per group, about its lead (D22-41): every room of the group
-- still standing. Null for a booking that is not confirmed: no voucher.
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
    'logoPng', (select encode(gs.logo, 'base64') from group_settings gs
                 where gs.logo_type = 'image/png'),
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
    'confirmedBy', (select s.full_name from confirmed c join staff s on s.id = c.actor),
    'confirmedAt', (select to_char(c.at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI')
                      from confirmed c)
  )
  from l join hotels h on h.id = l.hotel_id;
$fn$;

comment on function app.guest_voucher(uuid) is
  'The booking voucher''s facts, for the sweep and the desk''s Send voucher '
  '(D27-171, D27-172): the group''s standing rooms, each nightly rate and its '
  'GST rate from app.gst_rate_or_null (null where no rule: the voucher prints '
  'a dash). Null unless the booking is confirmed.';

revoke all on function app.guest_voucher(uuid) from public;
grant execute on function app.guest_voucher(uuid) to pms_app;
