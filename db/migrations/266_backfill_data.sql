-- ════════════════════════════════════════════════════════════════════
-- 266 — Backfill data: what happened before a hotel's first day
--       (the owner's D27-398, 7 November 2026; refer to it as
--       "backfill data", the master renumbers at merge)
--
--   A REGISTER OF ITS OWN, NEVER THE LIVE LEDGERS. A stay, a restaurant bill
--   and a cash line from before the hotel's first live day go in the three
--   tables below, and in none of reservations, folios, folio_postings,
--   pos_orders, cashier_shifts or invoices - so the night audit, the room
--   inventory, the GST invoice series, Form C's due list, the drawers, Tally
--   and the daily report emails never see them and cannot count them twice.
--   The one exception is the guest: found or added in `guests` (the
--   desk's own suggestion, D21-20), so a returning guest is recognised, and
--   the stay is on their Guest 360 as "Backfilled".
--
--   1 app.backfill_first_day   the hotel's first live day - ONE rule
--   2 app.backfill_refusal     the date rule, in words, or null
--   3 the three tables          constraints, row security, audit
--   4 the guard                 the date rule, a reason for every
--                               correction, a removed record frozen
--   5 a test hotel's trade; the full reset keeps their guests
--   6 Guest 360 lists a backfilled stay
--
-- No wipe and no reset of any kind is built (the owner's answer 1), and
-- nothing about how a hotel starts changes. Re-runnable.
-- ════════════════════════════════════════════════════════════════════


-- =============================================================================
-- 1 · THE HOTEL'S FIRST LIVE DAY
-- =============================================================================
-- hotels.business_date is the day a hotel was put on (made, cleared by the
-- owner's full reset, or moved by the owner's guarded step, D27-393); the
-- night audit never moves it (023: it moves app.business_date). A night audit
-- run on an earlier day - a date moved after the hotel had traded - makes that
-- day the first. So: the earlier of the two. A day is live or backfilled,
-- never both.
create or replace function app.backfill_first_day(p_hotel uuid)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select least(h.business_date,
               (select min(na.business_date) from night_audit_runs na where na.hotel_id = h.id))
    from hotels h
   where h.id = p_hotel
$$;

comment on function app.backfill_first_day(uuid) is
  'D27-398: the hotel''s first live day - hotels.business_date, or its earliest night audit if '
  'that is earlier. Only days before it are backfilled.';

grant execute on function app.backfill_first_day(uuid) to pms_app;


-- =============================================================================
-- 2 · THE DATE RULE, IN WORDS
-- =============================================================================
-- A record covers p_start to p_end: a stay its arrival and departure, a bill
-- or a cash line its one day (p_start = p_end). Null: allowed.
--   * never a future date (the hotel's own clock);
--   * it starts before the first day;
--   * it ends by the first day: a guest still in on the first day is a live
--     guest, checked in on the live screens.
create or replace function app.backfill_refusal(p_hotel uuid, p_start date, p_end date)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_start is null or p_end is null then 'A backfilled record needs its date.'
    when h.id is null then 'No such property.'
    when p_start >= f.first_day then format(
      'Only days before the hotel''s first day, %s, are backfilled. From that day on, use the normal screens.',
      to_char(f.first_day, 'FMDD Mon YYYY'))
    when p_end > f.first_day then format(
      'A backfilled stay ends by the hotel''s first day, %s. A guest still in on that day is checked in on the normal screens.',
      to_char(f.first_day, 'FMDD Mon YYYY'))
    -- Before a first day still to come (a hotel put on for a later date).
    when p_end > (now() at time zone h.timezone)::date then 'A date in the future is never backfilled.'
  end
  from (select p_hotel as id) x
  left join hotels h on h.id = x.id
  left join lateral (select app.backfill_first_day(h.id) as first_day) f on true
$$;

comment on function app.backfill_refusal(uuid, date, date) is
  'D27-398: why a backfilled record may not cover these days, or null. The one date rule; '
  'the tables'' guard and the API both ask it.';

grant execute on function app.backfill_refusal(uuid, date, date) to pms_app;


-- Who reads the register: the owner, an Admin and the GM (app.manages_hotel,
-- who also write) and the Accountant at this hotel (D27-398: "The Accountant
-- only reads").
create or replace function app.reads_backfill(p_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.manages_hotel(p_hotel) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role = 'finance')
$$;

comment on function app.reads_backfill(uuid) is
  'D27-398: who reads the backfilled records - app.manages_hotel (owner, Admin, GM, who also '
  'write) and the Accountant at this hotel.';

grant execute on function app.reads_backfill(uuid) to pms_app;


-- =============================================================================
-- 3 · THE THREE TABLES
-- =============================================================================
-- A figure nobody typed is NULL and shows as a dash, never a zero. Nothing is
-- deleted: a removed record stays, marked, with who and why (pms_app has no
-- delete). Every change is in the audit log (app.write_audit).

create table if not exists backfill_stays (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references hotels(id),
  -- The guest record (found by the desk's own suggestion, or added).
  guest_id         uuid not null references guests(id),
  -- What was typed, kept as typed: the register's own record.
  guest_name       text not null check (length(btrim(guest_name)) between 1 and 200),
  phone            text,
  email            text,
  nationality      text not null default 'IN',
  id_type          text not null check (id_type in ('passport', 'aadhaar', 'driving_licence', 'voter', 'other')),
  id_number        text not null check (length(btrim(id_number)) between 1 and 40),
  -- A foreign guest's visa or OCI number, and Form C's reference where it was
  -- filed outside the PMS (none: "Form C not recorded").
  visa_number      text,
  form_c_reference text,
  room_id          uuid not null references rooms(id),
  arrival          date not null,
  departure        date not null,
  adults           int  not null default 1 check (adults between 1 and 20),
  children         int  not null default 0 check (children between 0 and 20),
  rate             numeric(12,2) check (rate >= 0),
  room_charges     numeric(12,2) check (room_charges >= 0),
  gst              numeric(12,2) check (gst >= 0),
  other_charges    numeric(12,2) check (other_charges >= 0),
  other_charges_for text,
  paid             numeric(12,2) check (paid >= 0),
  -- The word of the hotel's payment method, as picked (191's label).
  paid_by          text,
  -- The hotel's own paper bill (rule 46: the PMS issues no tax invoice for a
  -- past day). None: a dash.
  bill_number      text,
  -- "Send the guest their bill and thank-you", ticked when it was added.
  send_bill        boolean not null default false,
  entered_by       uuid references staff(id) default app.current_user_id(),
  entered_at       timestamptz not null default now(),
  changed_by       uuid references staff(id),
  changed_at       timestamptz,
  change_reason    text check (change_reason is null or length(btrim(change_reason)) between 1 and 300),
  removed_by       uuid references staff(id),
  removed_at       timestamptz,
  removed_reason   text check (removed_reason is null or length(btrim(removed_reason)) between 1 and 300),

  constraint backfill_stays_nights check (departure > arrival),
  constraint backfill_stays_other_named check (
    other_charges is null or length(btrim(coalesce(other_charges_for, ''))) > 0),
  constraint backfill_stays_paid_how check ((paid is null) = (paid_by is null)),
  -- Immigration and Foreigners Rules 2025, Rule 17 / Form III: a foreign
  -- guest's passport, and their visa or OCI number - none for a citizen of
  -- Nepal or Bhutan (Exemption Order 2025, S.O. 3997(E), cl. 3(1)(c)).
  constraint backfill_stays_foreign_papers check (
    nationality = 'IN'
    or (id_type = 'passport'
        and (nationality in ('NP', 'BT') or length(btrim(coalesce(visa_number, ''))) > 0))),
  constraint backfill_stays_removed check ((removed_at is null) = (removed_reason is null)),
  -- Two backfilled stays in one room on one night: refused (the API names the other).
  constraint backfill_stays_one_room_a_night
    exclude using gist (room_id with =, daterange(arrival, departure) with &&)
    where (removed_at is null)
);
create index if not exists backfill_stays_by_hotel on backfill_stays (hotel_id, arrival);
create index if not exists backfill_stays_by_guest on backfill_stays (guest_id);

comment on table backfill_stays is
  'D27-398: a stay from before the hotel''s first day, as the hotel''s paper records have it. '
  'Never a reservation, a bill or an invoice; the guest is a real guest record.';

create table if not exists backfill_restaurant_bills (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id),
  outlet_id      uuid not null references pos_outlets(id),
  bill_date      date not null,
  bill_number    text,
  amount         numeric(12,2) check (amount >= 0),
  gst            numeric(12,2) check (gst >= 0),
  total          numeric(12,2) check (total >= 0),
  paid_by        text,
  note           text check (note is null or length(note) <= 300),
  entered_by     uuid references staff(id) default app.current_user_id(),
  entered_at     timestamptz not null default now(),
  changed_by     uuid references staff(id),
  changed_at     timestamptz,
  change_reason  text check (change_reason is null or length(btrim(change_reason)) between 1 and 300),
  removed_by     uuid references staff(id),
  removed_at     timestamptz,
  removed_reason text check (removed_reason is null or length(btrim(removed_reason)) between 1 and 300),
  constraint backfill_restaurant_bills_removed check ((removed_at is null) = (removed_reason is null))
);
create index if not exists backfill_restaurant_bills_by_hotel on backfill_restaurant_bills (hotel_id, bill_date);

comment on table backfill_restaurant_bills is
  'D27-398: a restaurant bill from before the hotel''s first day: the hotel''s own bill number and '
  'figures as typed. Never a POS order.';

create table if not exists backfill_cash (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id),
  cash_date      date not null,
  direction      text not null check (direction in ('in', 'out')),
  amount         numeric(12,2) not null check (amount > 0),
  purpose        text not null check (length(btrim(purpose)) between 1 and 200),
  person         text not null check (length(btrim(person)) between 1 and 120),
  entered_by     uuid references staff(id) default app.current_user_id(),
  entered_at     timestamptz not null default now(),
  changed_by     uuid references staff(id),
  changed_at     timestamptz,
  change_reason  text check (change_reason is null or length(btrim(change_reason)) between 1 and 300),
  removed_by     uuid references staff(id),
  removed_at     timestamptz,
  removed_reason text check (removed_reason is null or length(btrim(removed_reason)) between 1 and 300),
  constraint backfill_cash_removed check ((removed_at is null) = (removed_reason is null))
);
create index if not exists backfill_cash_by_hotel on backfill_cash (hotel_id, cash_date);

comment on table backfill_cash is
  'D27-398: cash in or out from before the hotel''s first day. Never a drawer movement.';

do $$
declare t text;
begin
  foreach t in array array['backfill_stays', 'backfill_restaurant_bills', 'backfill_cash'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists backfill_read on %I', t);
    execute format('drop policy if exists backfill_add on %I', t);
    execute format('drop policy if exists backfill_change on %I', t);
    -- Read: the owner, an Admin, the GM and the Accountant, at their hotel.
    execute format($p$create policy backfill_read on %I for select
      using (hotel_id in (select app.auth_hotel_ids()) and app.reads_backfill(hotel_id))$p$, t);
    -- Write: the owner, an Admin and the GM (app.manages_hotel).
    execute format($p$create policy backfill_add on %I for insert
      with check (hotel_id in (select app.auth_hotel_ids()) and app.manages_hotel(hotel_id))$p$, t);
    execute format($p$create policy backfill_change on %I for update
      using (hotel_id in (select app.auth_hotel_ids()) and app.manages_hotel(hotel_id))
      with check (hotel_id in (select app.auth_hotel_ids()) and app.manages_hotel(hotel_id))$p$, t);
    -- Nothing vanishes: no delete, ever.
    execute format('revoke all on %I from pms_app', t);
    execute format('grant select, insert, update on %I to pms_app', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I
                      for each row execute function app.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- A real hotel's stay never holds a test hotel's guest, nor the other way (212).
drop trigger if exists backfill_stays_keeps_sides on backfill_stays;
create trigger backfill_stays_keeps_sides
  before insert or update of hotel_id, guest_id on backfill_stays
  for each row execute function app.keep_sides('guest_id', 'guests');


-- =============================================================================
-- 4 · THE GUARD
-- =============================================================================
-- On every write: the date rule (app.backfill_refusal), the room or outlet is
-- the hotel's own, a correction carries its reason, and a removed record is
-- never changed again. Who and when are the database's, not the caller's.
create or replace function app.backfill_guard()
returns trigger
language plpgsql
as $fn$
declare
  j     jsonb := to_jsonb(new);
  v_why text;
begin
  if tg_op = 'UPDATE' then
    if old.removed_at is not null then
      raise exception 'A removed record stays on the record as it was. It is not changed again.'
        using errcode = 'check_violation';
    end if;
    if new.removed_at is not null then
      new.removed_by := app.current_user_id();
      new.removed_at := now();
      return new;
    end if;
    if new.change_reason is null or btrim(new.change_reason) = '' then
      raise exception 'A correction needs its reason.' using errcode = 'check_violation';
    end if;
    new.changed_by := app.current_user_id();
    new.changed_at := now();
    new.entered_by := old.entered_by;
    new.entered_at := old.entered_at;
  else
    if new.removed_at is not null or new.change_reason is not null then
      raise exception 'A new record is neither corrected nor removed yet.' using errcode = 'check_violation';
    end if;
    new.entered_by := app.current_user_id();
    new.entered_at := now();
  end if;

  v_why := app.backfill_refusal(new.hotel_id,
    coalesce(j ->> 'arrival', j ->> 'bill_date', j ->> 'cash_date')::date,
    coalesce(j ->> 'departure', j ->> 'bill_date', j ->> 'cash_date')::date);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;

  if j ? 'room_id' and not exists (
       select 1 from rooms r where r.id = (j ->> 'room_id')::uuid and r.hotel_id = new.hotel_id) then
    raise exception 'That room is not one of this hotel''s.' using errcode = 'check_violation';
  end if;
  if j ? 'outlet_id' and not exists (
       select 1 from pos_outlets o where o.id = (j ->> 'outlet_id')::uuid and o.hotel_id = new.hotel_id) then
    raise exception 'That restaurant is not one of this hotel''s.' using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

do $$
declare t text;
begin
  foreach t in array array['backfill_stays', 'backfill_restaurant_bills', 'backfill_cash'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard', t);
    execute format('create trigger %I before insert or update on %I
                      for each row execute function app.backfill_guard()', t || '_guard', t);
  end loop;
end $$;


-- =============================================================================
-- 5 · A TEST HOTEL'S TRADE; THE FULL RESET KEEPS THEIR GUESTS
-- =============================================================================
-- A test hotel's Reset clears them with its other trade (212).
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('backfill_stays' in d) = 0 then
    execute replace(d, $q$('stay_requests', 'trading')$q$,
                       $q$('stay_requests', 'trading'), ('backfill_stays', 'trading'), ('backfill_restaurant_bills', 'trading'), ('backfill_cash', 'trading')$q$);
  end if;
end $$;

-- The owner's full reset (250) clears a hotel's live trade and the guests
-- left with nothing elsewhere. Backfilled records are not live trade and are
-- not cleared (no wipe is built), so a guest with a backfilled stay anywhere
-- is kept - or the clear would stop on this table's key. 253's rule, plus one line.
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
     and not exists (select 1 from backfill_stays s where s.guest_id = g.id)
$fn$;


-- =============================================================================
-- 6 · GUEST 360 LISTS A BACKFILLED STAY
-- =============================================================================
-- 212's function, with one change: the list of stays also holds the person's
-- backfilled stays (not removed), status "backfilled". The totals above it -
-- nights, charged, first and last stay, visits - stay the live stays' alone.
create or replace function app.guest_360(p_guest uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive
  person as (
    select g.* from guests g
     where g.id = app.guest_standing(p_guest)
       and app.is_crm_manager()
       and g.test_hotel_id is not distinct from (select app.view_side())
       and (select app.sees_view_side())
  ),
  family(id) as (
    select id from person
    union
    select g.id from family f join guests g on g.joined_into = f.id
  ),
  phones as (
    select distinct app.phone_key(g.phone) as k
      from family f join guests g on g.id = f.id
     where app.phone_key(g.phone) is not null
  ),
  emails as (
    select distinct app.email_key(g.email::text) as k
      from family f join guests g on g.id = f.id
     where app.email_key(g.email::text) is not null
  ),
  stays as (
    select r.id, r.check_in, r.check_out, r.status, r.group_id,
           h.code as hotel_code, h.name as hotel_name, r.reference,
           rt.name as room_type,
           app.booking_source_label(bs.name, co.name, r.source) as source,
           co.name as company,
           app.stay_charged(r.id) as charged
      from person p
      join reservations r on r.guest_id = p.id
      join hotels h on h.id = r.hotel_id
      left join room_types rt on rt.id = r.room_type_id
      left join booking_sources bs on bs.id = r.booking_source_id
      left join companies co on co.id = r.company_id
  ),
  -- D27-398: a stay from before the hotel's first day. Its figures as typed;
  -- none typed is null (a dash), never a zero.
  backfilled as (
    select b.id, b.arrival, b.departure, h.code as hotel_code, h.name as hotel_name,
           coalesce('Bill ' || nullif(btrim(b.bill_number), ''), 'Backfilled') as reference,
           rt.name as room_type,
           case when b.room_charges is null and b.gst is null and b.other_charges is null then null
                else coalesce(b.room_charges, 0) + coalesce(b.gst, 0) + coalesce(b.other_charges, 0) end as charged
      from person p
      join backfill_stays b on b.guest_id = p.id and b.removed_at is null
      join hotels h on h.id = b.hotel_id
      join rooms rm on rm.id = b.room_id
      left join room_types rt on rt.id = rm.room_type_id
  ),
  sent as (
    select m.sent_at, m.channel, m.kind, m.status, h.name as hotel_name
      from messages_sent m
      join hotels h on h.id = m.hotel_id
     where ((m.about_kind = 'reservation' and m.about_id in (select id::text from stays))
        or app.phone_key(m.to_phone) in (select k from phones)
        or app.email_key(m.to_email) in (select k from emails))
       -- the same phone at a hotel on the other side is another person's
       and (case when h.test_of is null then null else h.id end)
           is not distinct from (select app.view_side())
  )
  select jsonb_build_object(
    'id', p.id,
    'name', p.full_name,
    'phone', p.phone,
    'email', p.email::text,
    'nationality', p.nationality,
    'isVip', p.is_vip,
    'isBlacklisted', p.is_blacklisted,
    'blacklistReason', p.blacklist_reason,
    'hasId', exists (select 1 from guest_documents d where d.guest_id in (select id from family)),
    'companies', coalesce((select jsonb_agg(distinct s.company) from stays s where s.company is not null), '[]'),
    'visits', app.guest_visits(p.id),
    'nights', coalesce((select sum(greatest(s.check_out - s.check_in, 0))::int from stays s
                         where s.status in ('checked_in', 'checked_out')), 0),
    'charged', coalesce((select sum(s.charged) from stays s), 0),
    'firstStay', (select min(s.check_in)::text from stays s where s.status in ('checked_in', 'checked_out')),
    'lastStay', (select max(s.check_out)::text from stays s where s.status in ('checked_in', 'checked_out')),
    'stays', coalesce((
      select jsonb_agg(x.o order by x.check_in desc, x.reference)
        from (
          select s.check_in, s.reference, jsonb_build_object(
                   'id', s.id, 'hotelCode', s.hotel_code, 'hotelName', s.hotel_name,
                   'reference', s.reference, 'checkIn', s.check_in::text,
                   'checkOut', s.check_out::text, 'status', s.status,
                   'roomType', s.room_type, 'source', s.source, 'charged', s.charged) as o
            from stays s
          union all
          select b.arrival, b.reference, jsonb_build_object(
                   'id', b.id, 'hotelCode', b.hotel_code, 'hotelName', b.hotel_name,
                   'reference', b.reference, 'checkIn', b.arrival::text,
                   'checkOut', b.departure::text, 'status', 'backfilled',
                   'roomType', b.room_type, 'source', null, 'charged', b.charged)
            from backfilled b
        ) x), '[]'),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', m.sent_at, 'channel', m.channel, 'kind', m.kind,
               'status', m.status, 'hotelName', m.hotel_name)
             order by m.sent_at desc)
        from sent m), '[]'),
    'noOffers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'value', o.value,
                                          'at', o.recorded_at) order by o.recorded_at)
        from offer_opt_outs o
       where ((o.kind = 'phone' and o.value in (select k from phones))
          or (o.kind = 'email' and o.value in (select k from emails)))
         and o.test_hotel_id is not distinct from (select app.view_side())), '[]'),
    'joined', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'guestId', j.joined_id,
                                          'name', g.full_name, 'at', j.joined_at)
             order by j.joined_at desc)
        from guest_joins j join guests g on g.id = j.joined_id
       where j.kept_id = p.id and j.undone_at is null), '[]')
  )
  from person p
$$;
