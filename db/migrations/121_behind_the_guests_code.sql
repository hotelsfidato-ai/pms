-- =============================================================================
-- 121 · Behind the guest's six digits (D21-6 to D21-19, D21-63)
-- =============================================================================
-- Migration 114 built the guest's door up to the code. This is what the code
-- opens, and four rules shape every line of it:
--
--   · THE CODE UNLOCKS A PHONE, NOT THE LINK (D21-6). Answering it used to set
--     `guest_links.verified_at`, and from then on the link alone - forwarded to
--     a family group, left open on a tablet - would have opened everything for
--     the life of the stay. Now the answer hands back a second secret, kept
--     here only as a hash and alive for an hour, and every function behind the
--     code takes BOTH hashes. `verified_at` stays as a record of when a code
--     was answered; nothing reads it for access any more.
--
--   · A ROOM CARD NAMES A ROOM (D21-7, D21-14 to D21-16). One fixed card per
--     room, the owner's choice. Its token never names a booking: every call
--     resolves the room to the stay checked in there AT THAT MOMENT. An unlock
--     remembers the stay it was issued for, so the next guest's scan reaches
--     nothing of the last guest's even if an old unlock were replayed.
--
--   · NOTHING A GUEST TYPES REACHES THE LEGAL REGISTER WITHOUT A PERSON (D21-8).
--     `guest_documents` is one row per person for the whole group, and Form C
--     reads it live. So the guest's details wait here, and a clerk comparing
--     them with the ID presses one button to write them - under the clerk's
--     own session, through the ordinary staff route.
--
--   · NEVER ANOTHER SERVICE'S TABLES (D21-9). A spa or laundry request is a
--     request; the desk books it through the spa's and laundry's own screens.
--
-- Every function the door may call takes HASHES only - the link's and the
-- unlock's - and answers about the one stay they resolve to. Nothing here
-- takes a booking id from the caller.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · A link may name a ROOM instead of a booking
-- -----------------------------------------------------------------------------
alter table guest_links alter column reservation_id drop not null;
alter table guest_links add column if not exists room_id uuid references rooms(id);

alter table guest_links drop constraint if exists guest_links_names_one_thing;
alter table guest_links add constraint guest_links_names_one_thing
  check ((reservation_id is null) <> (room_id is null));

comment on constraint guest_links_names_one_thing on guest_links is
  'A booking''s own link, or a room''s fixed card - never both, never neither. '
  'A card that also named a booking would open that booking for the next guest.';

alter table guest_links drop constraint if exists guest_links_origin_check;
alter table guest_links add constraint guest_links_origin_check
  check (origin in ('desk', 'confirmation', 'qr', 'room'));

-- ONE live card per room. Printing a new one kills the old one (D21-16), and
-- this index is what makes "the old one" a single row.
create unique index if not exists guest_links_one_live_card_per_room
  on guest_links (room_id) where room_id is not null and revoked_at is null;

-- -----------------------------------------------------------------------------
-- 2 · A code remembers which stay it was sent for
-- -----------------------------------------------------------------------------
-- For a booking's link that is always its booking. For a room card it is the
-- stay checked in when the code was asked for - so a code asked for by one
-- guest cannot be answered after the next has checked in.
alter table guest_link_codes add column if not exists reservation_id uuid;

-- NAMED, and dropped and made again each run, so the rule it carries can
-- change: a column added `if not exists` keeps whatever foreign key it was
-- first made with. ON DELETE CASCADE because a code exists only for its stay -
-- and a property reset that clears bookings must not stop at this table
-- (api/test/resetOrder.test.ts, "leaves nothing behind").
alter table guest_link_codes drop constraint if exists guest_link_codes_reservation_id_fkey;
alter table guest_link_codes drop constraint if exists guest_link_codes_for_the_stay;
alter table guest_link_codes add constraint guest_link_codes_for_the_stay
  foreign key (reservation_id) references reservations(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- 3 · The unlock: what answering the code gives THIS phone (D21-6)
-- -----------------------------------------------------------------------------
create table if not exists guest_unlocks (
  id             uuid primary key default gen_random_uuid(),
  link_id        uuid not null references guest_links(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  -- sha256, hex. The secret itself lives in the guest's open tab and nowhere
  -- else; a query log or a backup is not a set of unlocked pages.
  unlock_hash    text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

comment on table guest_unlocks is
  'Answering the six digits unlocks the phone that answered, for an hour - not '
  'the link (D21-6). A forwarded link shows the name and dates and asks for a '
  'code again.';

-- Closed, like the codes: nothing a person does reads it, and the door reaches
-- it only through the definer functions below.
alter table guest_unlocks enable row level security;
alter table guest_unlocks force  row level security;

-- -----------------------------------------------------------------------------
-- 4 · The details a guest sends, waiting for a clerk (D21-8, D21-19)
-- -----------------------------------------------------------------------------
-- The same fields as `guest_documents` and nothing more, so what the clerk
-- confirms is written across one-for-one.
create table if not exists guest_detail_submissions (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id),
  -- Goes with its stay: a submission is not the record - guest_documents is,
  -- once a clerk has confirmed it.
  reservation_id  uuid not null references reservations(id) on delete cascade,
  guest_id        uuid not null references guests(id),

  id_type         text not null,
  -- AADHAAR IS STORED WHOLE (D21-17, the owner's choice). Every screen shows
  -- the last four digits (D21-18); the staff route masks it before it leaves.
  id_number       text not null,
  passport_expiry date,
  visa_number     text,
  visa_expiry     date,
  address_line    text,
  city            text,
  country         text,

  submitted_at    timestamptz not null default now(),
  status          text not null default 'waiting',
  handled_by      uuid references staff(id),
  handled_at      timestamptz,

  constraint gds_id_type_valid check (id_type in
    ('aadhaar', 'passport', 'driving_licence', 'voter', 'other')),
  constraint gds_number_present check (length(trim(id_number)) > 0),
  constraint gds_status_valid check (status in ('waiting', 'confirmed', 'set_aside')),
  constraint gds_handled_says_who check (
    (status = 'waiting') = (handled_by is null and handled_at is null))
);

comment on table guest_detail_submissions is
  'What a guest typed on their own page. It reaches guest_documents - and so '
  'Form C - only when a clerk has compared it with the ID and confirmed it '
  '(D21-8).';

-- One waiting submission per stay: sending again replaces what was waiting.
create unique index if not exists guest_detail_submissions_one_waiting
  on guest_detail_submissions (reservation_id) where status = 'waiting';
create index if not exists guest_detail_submissions_by_hotel
  on guest_detail_submissions (hotel_id, status, submitted_at desc);

alter table guest_detail_submissions enable row level security;
alter table guest_detail_submissions force  row level security;
drop policy if exists guest_detail_submissions_by_hotel on guest_detail_submissions;
create policy guest_detail_submissions_by_hotel on guest_detail_submissions
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
-- A clerk reads and confirms; only the guest's definer function inserts.
grant select, update on guest_detail_submissions to pms_app;

-- -----------------------------------------------------------------------------
-- 5 · A spa or laundry request (D21-9, D21-63)
-- -----------------------------------------------------------------------------
create table if not exists guest_requests (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id),
  reservation_id uuid not null references reservations(id) on delete cascade,
  kind           text not null,
  what           text not null,
  -- In the guest's own words ("tomorrow morning"): a request, not a booking,
  -- so it is not a slot in anybody's diary.
  wanted         text,
  status         text not null default 'open',
  created_at     timestamptz not null default now(),
  handled_by     uuid references staff(id),
  handled_at     timestamptz,

  constraint gr_kind_valid check (kind in ('spa', 'laundry')),
  constraint gr_what_sane check (length(trim(what)) between 1 and 500),
  constraint gr_wanted_sane check (wanted is null or length(wanted) <= 100),
  constraint gr_status_valid check (status in ('open', 'done', 'declined')),
  constraint gr_handled_says_who check (
    (status = 'open') = (handled_by is null and handled_at is null))
);

comment on table guest_requests is
  'A guest asking for the spa or laundry from their own page. The desk books it '
  'through the spa''s and laundry''s own screens and marks this done; online '
  'check-in never writes to their tables (D21-9).';

create index if not exists guest_requests_by_hotel
  on guest_requests (hotel_id, status, created_at desc);

alter table guest_requests enable row level security;
alter table guest_requests force  row level security;
drop policy if exists guest_requests_by_hotel on guest_requests;
create policy guest_requests_by_hotel on guest_requests
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, update on guest_requests to pms_app;

-- =============================================================================
-- The functions. Two are internal (never granted): the resolver and the
-- unlock check every other function goes through.
-- =============================================================================

-- Which stay does this token reach, right now? A booking's link: its booking.
-- A room card: the stay CHECKED IN to that room at this moment - a live
-- assignment on a checked-in booking, from the hotel's own business date. A
-- guest due out today is still in the room until the desk checks them out.
create or replace function app.guest_link_stay(p_token_hash text)
returns table (link_id uuid, hotel_id uuid, room_id uuid, reservation_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select l.id, l.hotel_id, l.room_id,
         coalesce(l.reservation_id, (
           select ra.reservation_id
             from room_assignments ra
             join reservations r on r.id = ra.reservation_id
            where ra.room_id = l.room_id
              and ra.released_at is null
              and r.status = 'checked_in'
              and ra.from_date <= app.business_date(l.hotel_id)
            -- TWO CHECKED IN AT ONCE is real: the guest due out this morning is
            -- still checked in when the next one is checked in to the same room
            -- (the demo's room 201 on 25 August). The room is the ARRIVING
            -- guest's tonight, so the latest assignment wins. Either answer is
            -- safe - the code goes only to the phone of the stay chosen here -
            -- but it must be one answer, so the tie is broken too.
            order by ra.from_date desc, ra.created_at desc
            limit 1))
    from guest_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > now();
$fn$;

comment on function app.guest_link_stay(text) is
  'The one place a token becomes a stay. A room card resolves to whoever is '
  'checked in there now, never to a booking stored on the card (D21-7).';

-- Behind the code: the stay, and ONLY if this unlock was issued for this link
-- AND this stay and has not expired. Every function below starts here.
create or replace function app.guest_unlocked(p_token_hash text, p_unlock_hash text)
returns table (link_id uuid, hotel_id uuid, reservation_id uuid, guest_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s.link_id, s.hotel_id, s.reservation_id, r.guest_id
    from app.guest_link_stay(p_token_hash) s
    join reservations r   on r.id = s.reservation_id
    join guest_unlocks u  on u.link_id = s.link_id
                         and u.reservation_id = s.reservation_id
   where u.unlock_hash = p_unlock_hash
     and u.expires_at > now()
   limit 1;
$fn$;

comment on function app.guest_unlocked(text, text) is
  'Asked by every function behind the code, in the database, every time. The '
  'link alone answers nothing here (D21-6).';

-- What the page may show. Before the code: for a booking's link, the guest's
-- own name, dates and the last four digits of the booking's number (114); for
-- a room card, the hotel and the room and nothing else (D21-14) - not even
-- whether the phone ends in 0011, because whoever holds the card is standing
-- in somebody's room. After the code: the booking, and which requests the
-- hotel offers (D21-63).
drop function if exists app.guest_link_open(text);
create or replace function app.guest_link_open(p_token_hash text, p_unlock_hash text default null)
returns table (
  link_id uuid, kind text, hotel_id uuid, hotel_code text, hotel_name text,
  room_number text, occupied boolean,
  reservation_id uuid, reference text, guest_name text,
  check_in text, check_out text, status text,
  verified boolean, phone_hint text, offers text[]
)
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  update guest_links set last_seen_at = now()
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  with s as (select * from app.guest_link_stay(p_token_hash)),
       u as (select exists (select 1 from app.guest_unlocked(p_token_hash, p_unlock_hash)) as ok)
  select s.link_id,
         case when s.room_id is null then 'booking' else 'room' end,
         h.id, h.code, h.name,
         rm.number,
         s.reservation_id is not null,
         case when s.room_id is null or u.ok then r.id end,
         case when s.room_id is null or u.ok then r.reference end,
         case when s.room_id is null or u.ok then g.full_name end,
         case when s.room_id is null or u.ok then r.check_in::text end,
         case when s.room_id is null or u.ok then r.check_out::text end,
         case when s.room_id is null or u.ok then r.status end,
         u.ok,
         case when s.room_id is not null then null
              when g.phone is null or length(g.phone) < 4 then null
              else '…' || right(g.phone, 4) end,
         case when u.ok then array(
           select k from unnest(array['spa', 'laundry']) k
            where app.module_enabled(s.hotel_id, k)) end
    from s
    cross join u
    join hotels h on h.id = s.hotel_id
    left join rooms rm       on rm.id = s.room_id
    left join reservations r on r.id = s.reservation_id
    left join guests g       on g.id = r.guest_id;
$fn$;

comment on function app.guest_link_open(text, text) is
  'What a guest''s page may show. Before the code: a booking''s name and dates, '
  'or a room card''s hotel and room only (D21-14). After it, on the phone that '
  'answered: the booking (D21-6).';

-- A code for the number the RESOLVED STAY carries. Unchanged from 114 but for
-- that: a room card's code goes to whoever is checked in there now, and the
-- code remembers which stay it was for.
--
-- It also hands the API what the WhatsApp message needs - the stay, its
-- reference, the guest's name, the hotel. Those never reach the caller of the
-- door; they go only into the message to the booking's own phone. (The door
-- used to re-open the link to find them, and on a room card that - rightly -
-- answers no name and no booking before the code: the message would have gone
-- out addressed to nobody. Found by the type checker, 21 September.)
--
-- ⚠ AND THE NUMBER TO SEND TO, WHOLE (OCI-2). 114 returned only `sent_to`, the
-- MASKED "…0011" kept for the record, and the door passed that to the sender
-- as the recipient - so the first code sent once WhatsApp was connected would
-- have gone to "…0011", which is nobody. `phone` is the booking's own number;
-- the door hands it to `send()` and to nothing else.
--
-- ⚠ A NEW NAME, AND 114's IS DROPPED - NOT REPLACED. Every deploy replays the
-- migrations from 001, so 114 re-creates `guest_code_issue(text, text)` with
-- its own return type on every run. Had this changed that function's return
-- type, the replay would stop at 114 with "cannot change return type of
-- existing function" - which is exactly what the second run of this file did
-- on 21 September, before this rename. 114 makes the old one each run; this
-- drops it each run; the two never meet on one signature.
drop function if exists app.guest_code_issue(text, text);
create or replace function app.guest_code_make(p_token_hash text, p_phone text)
returns table (code text, sent_to text, phone text, reservation_id uuid, reference text,
               guest_name text, hotel_id uuid, hotel_code text, hotel_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link  uuid;
  v_stay  uuid;
  v_phone text;
  v_code  text;
begin
  select s.link_id, s.reservation_id, g.phone into v_link, v_stay, v_phone
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null or v_phone is null then
    return;                                     -- nothing, and nothing said
  end if;

  if right(regexp_replace(v_phone, '\D', '', 'g'), 10)
     <> right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) then
    return;
  end if;

  v_code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  update guest_link_codes set consumed_at = now()
   where link_id = v_link and consumed_at is null;

  insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
  values (v_link, v_stay, encode(digest(v_code, 'sha256'), 'hex'),
          '…' || right(regexp_replace(v_phone, '\D', '', 'g'), 4),
          now() + interval '10 minutes');

  return query
    select v_code, '…' || right(regexp_replace(v_phone, '\D', '', 'g'), 4),
           v_phone, r.id, r.reference, g.full_name, h.id, h.code, h.name
      from reservations r
      join guests g on g.id = r.guest_id
      join hotels h on h.id = r.hotel_id
     where r.id = v_stay;
end
$fn$;

-- The answer. True once, for the right code, for the stay it was sent for; and
-- then - in the same statement, so there is no moment between - the unlock the
-- API generated is recorded against this link and this stay. Five wrong
-- answers and the code is dead, as in 114.
drop function if exists app.guest_code_check(text, text);
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
    -- AN HOUR - the owner's answer, D21-92. Long enough to fill the form on a
    -- slow wifi; a guest who comes back later asks for a new code.
    insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
    values (v_link, v_stay, p_unlock_hash, now() + interval '1 hour');
  end if;

  return v_ok;
end
$fn$;

comment on function app.guest_code_answer(text, text, text) is
  'The six digits, answered. On the right code it records the unlock for THIS '
  'phone and this stay - not the link (D21-6). Five wrong answers kill the code.';

-- The details, sent. Refused - false, and nothing written - unless unlocked.
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
     passport_expiry, visa_number, visa_expiry, address_line, city, country)
  values
    (v.hotel_id, v.reservation_id, v.guest_id,
     p_details->>'idType', trim(p_details->>'idNumber'),
     nullif(p_details->>'passportExpiry', '')::date,
     nullif(trim(p_details->>'visaNumber'), ''),
     nullif(p_details->>'visaExpiry', '')::date,
     nullif(trim(p_details->>'addressLine'), ''),
     nullif(trim(p_details->>'city'), ''),
     nullif(trim(p_details->>'country'), ''))
  on conflict (reservation_id) where status = 'waiting' do update set
     id_type = excluded.id_type, id_number = excluded.id_number,
     passport_expiry = excluded.passport_expiry,
     visa_number = excluded.visa_number, visa_expiry = excluded.visa_expiry,
     address_line = excluded.address_line, city = excluded.city,
     country = excluded.country, submitted_at = now();

  return true;
end
$fn$;

comment on function app.guest_details_submit(text, text, jsonb) is
  'A guest''s ID and address, WAITING for a clerk (D21-8). Nothing is written '
  'to guest_documents here.';

-- What the guest has sent, and whether the desk has seen it. An Aadhaar comes
-- back as its last four digits, on this screen as on every other (D21-18).
create or replace function app.guest_details_state(p_token_hash text, p_unlock_hash text)
returns table (status text, submitted_at timestamptz, id_type text, id_last_four text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select d.status, d.submitted_at, d.id_type, right(d.id_number, 4)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guest_detail_submissions d on d.reservation_id = v.reservation_id
   order by d.submitted_at desc
   limit 1;
$fn$;

-- A request - only for what the hotel has switched on (D21-63), and no more
-- than ten open at once, so a stolen unlock cannot bury the desk.
create or replace function app.guest_request_make(
  p_token_hash text, p_unlock_hash text, p_kind text, p_what text, p_wanted text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null
     or p_kind not in ('spa', 'laundry')
     or not app.module_enabled(v.hotel_id, p_kind)
     or (select count(*) from guest_requests
          where reservation_id = v.reservation_id and status = 'open') >= 10 then
    return false;
  end if;

  insert into guest_requests (hotel_id, reservation_id, kind, what, wanted)
  values (v.hotel_id, v.reservation_id, p_kind, trim(p_what), nullif(trim(p_wanted), ''));
  return true;
end
$fn$;

create or replace function app.guest_requests_mine(p_token_hash text, p_unlock_hash text)
returns table (kind text, what text, wanted text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select q.kind, q.what, q.wanted, q.status, q.created_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guest_requests q on q.reservation_id = v.reservation_id
   order by q.created_at desc;
$fn$;

-- -----------------------------------------------------------------------------
-- Who may call what. The two internal functions are NOT granted: the door
-- cannot resolve a token or test an unlock except through a function that
-- also decides what to answer.
-- -----------------------------------------------------------------------------
revoke execute on function app.guest_link_stay(text)        from public;
revoke execute on function app.guest_unlocked(text, text)   from public;

grant execute on function app.guest_link_open(text, text)                     to pms_app;
grant execute on function app.guest_code_make(text, text)                     to pms_app;
grant execute on function app.guest_code_answer(text, text, text)             to pms_app;
grant execute on function app.guest_details_submit(text, text, jsonb)         to pms_app;
grant execute on function app.guest_details_state(text, text)                 to pms_app;
grant execute on function app.guest_request_make(text, text, text, text, text) to pms_app;
grant execute on function app.guest_requests_mine(text, text)                 to pms_app;
