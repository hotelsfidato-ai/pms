-- =============================================================================
-- 173 — a table at the restaurant, booked by a guest of the hotel (D27-221, D27-224)
-- =============================================================================
-- The owner, 1 October (docs/briefs/guest-in-stay-plan.md, section D): a guest
-- of the hotel asks for a table from their own page for any night of the stay;
-- a person at the restaurant confirms or declines each request - no capacity
-- rules. Lunch 12:30-15:00 and dinner 19:30-23:00 in half-hour slots, as the
-- default for a restaurant whose hours nobody has set, changed per restaurant
-- on Restaurant setup.
--
-- The staff half: the hours, the bookings and the one definition of a day's
-- slots (sections 1-3). The guest's half: four functions behind the door's
-- unlock (section 4; the door is api/src/routes/guestTables.ts).
--
-- The master numbers it at merge; refer to it as "a table for the guest".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · each restaurant's booking hours
-- -----------------------------------------------------------------------------
-- 'HH:MM-HH:MM', on the half hour, opening before closing. NULL is the owner's
-- default (lunch 12:30-15:00, dinner 19:30-23:00); '' is "that meal is not
-- offered" - both '' and the restaurant takes no bookings.
-- -----------------------------------------------------------------------------
alter table pos_outlets add column if not exists table_lunch  text;
alter table pos_outlets add column if not exists table_dinner text;

alter table pos_outlets drop constraint if exists pos_outlets_table_hours_shape;
alter table pos_outlets add constraint pos_outlets_table_hours_shape check (
  (table_lunch is null or table_lunch = ''
     or (table_lunch ~ '^([01][0-9]|2[0-3]):[03]0-([01][0-9]|2[0-3]):[03]0$'
         and split_part(table_lunch, '-', 1) < split_part(table_lunch, '-', 2)))
  and
  (table_dinner is null or table_dinner = ''
     or (table_dinner ~ '^([01][0-9]|2[0-3]):[03]0-([01][0-9]|2[0-3]):[03]0$'
         and split_part(table_dinner, '-', 1) < split_part(table_dinner, '-', 2))));

comment on column pos_outlets.table_lunch is
  'Table booking at lunch, ''HH:MM-HH:MM'' (D27-224). NULL: the owner''s default '
  '12:30-15:00. Empty: lunch is not offered.';
comment on column pos_outlets.table_dinner is
  'Table booking at dinner, ''HH:MM-HH:MM'' (D27-224). NULL: the owner''s default '
  '19:30-23:00. Empty: dinner is not offered.';


-- -----------------------------------------------------------------------------
-- 2 · a day's slots - the one definition
-- -----------------------------------------------------------------------------
-- Every half hour from a meal's opening to half an hour before it ends (the
-- last seating), on that date IN THE HOTEL'S TIME ZONE. The guest's offer, a
-- booking's check and Restaurant setup's preview all ask this.
-- -----------------------------------------------------------------------------
create or replace function app.table_slots(p_outlet uuid, p_date date)
returns setof timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s at time zone h.timezone
    from pos_outlets o
    join hotels h on h.id = o.hotel_id
   cross join lateral unnest(array[coalesce(o.table_lunch, '12:30-15:00'),
                                   coalesce(o.table_dinner, '19:30-23:00')]) w
   cross join lateral generate_series(
           p_date + split_part(w, '-', 1)::time,
           p_date + split_part(w, '-', 2)::time - interval '30 minutes',
           interval '30 minutes') s
   where o.id = p_outlet and w <> ''
   order by 1;
$fn$;

comment on function app.table_slots(uuid, date) is
  'A restaurant''s table-booking slots on a date, in its hotel''s time zone: '
  'every half hour of each meal''s hours, the last half an hour before it ends '
  '(D27-224).';

revoke all on function app.table_slots(uuid, date) from public;
grant execute on function app.table_slots(uuid, date) to pms_app;


-- -----------------------------------------------------------------------------
-- 3 · the bookings
-- -----------------------------------------------------------------------------
-- A guest's request for a table, for one stay. Requested until a person at the
-- restaurant confirms it (a table may be named) or declines it (with a reason
-- the guest reads); the guest may cancel only while it is requested.
-- -----------------------------------------------------------------------------
create table if not exists table_bookings (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id),
  outlet_id       uuid not null references pos_outlets(id),
  reservation_id  uuid not null references reservations(id),
  party           smallint not null,
  at              timestamptz not null,
  note            text,
  status          text not null default 'requested',
  table_id        uuid references pos_tables(id),
  answer          text,
  answered_by     uuid references staff(id),
  answered_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint table_bookings_party   check (party between 1 and 20),
  constraint table_bookings_note    check (note is null or char_length(note) <= 200),
  constraint table_bookings_answer  check (answer is null or char_length(answer) <= 200),
  constraint table_bookings_status  check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  /* A guest reads why: a decline always says. */
  constraint table_bookings_declined_says_why check (
    status <> 'declined' or nullif(btrim(answer), '') is not null),
  /* A table is named only on a confirmed booking. */
  constraint table_bookings_table_when_confirmed check (table_id is null or status = 'confirmed')
);

create index if not exists table_bookings_hotel_at_idx on table_bookings (hotel_id, at);
create index if not exists table_bookings_stay_idx     on table_bookings (reservation_id);

comment on table table_bookings is
  'A hotel guest''s request for a table at the restaurant (D27-221, D27-224): '
  'confirmed or declined by a person, no capacity rules.';

/* The restaurant, the stay and the table are all this hotel's. */
create or replace function app.table_booking_is_here()
returns trigger language plpgsql as $$
begin
  if (select hotel_id from pos_outlets where id = new.outlet_id) is distinct from new.hotel_id then
    raise exception 'that restaurant is at another property';
  end if;
  if (select hotel_id from reservations where id = new.reservation_id) is distinct from new.hotel_id then
    raise exception 'that stay is at another property';
  end if;
  if new.table_id is not null
     and (select hotel_id from pos_tables where id = new.table_id) is distinct from new.hotel_id then
    raise exception 'that table is at another property';
  end if;
  return new;
end $$;

drop trigger if exists table_bookings_is_here on table_bookings;
create trigger table_bookings_is_here before insert or update on table_bookings
  for each row execute function app.table_booking_is_here();

alter table table_bookings enable row level security;
alter table table_bookings force  row level security;

/* Read by the hotel's staff; answered by them (the role is the route's and the
   role gate's). Made only by the guest's own function, never by pms_app. */
drop policy if exists table_bookings_read on table_bookings;
create policy table_bookings_read on table_bookings
  for select using ( hotel_id in (select app.auth_hotel_ids()) );

drop policy if exists table_bookings_answer on table_bookings;
create policy table_bookings_answer on table_bookings
  for update
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, update on table_bookings to pms_app;

drop trigger if exists table_bookings_audit on table_bookings;
create trigger table_bookings_audit after insert or update or delete on table_bookings
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 4 · the guest's side, behind the door's unlock
-- -----------------------------------------------------------------------------
-- The door's rules (online-checkin/MODULE.md, rule 8): each function takes the
-- token's hash and this phone's unlock's hash and finds the stay ONLY through
-- app.guest_unlocked - never a stay, outlet or table id from the caller; a
-- refusal is "nothing" (an empty answer, or false). Nobody widens
-- app.guest_link_open. db/tests/modules/pos.sql calls each with the link's
-- hash and no unlock (OCI-5).
--
-- Who: a hotel guest whose booking is confirmed (the page opens before
-- arrival) or who is checked in (the owner's answer, 1 October). Which nights:
-- any night of the stay from the hotel's today, the slots still to come.
-- -----------------------------------------------------------------------------

/* What this guest may ask for: each restaurant, each night, the slots left. */
create or replace function app.guest_table_offer(p_token_hash text, p_unlock_hash text)
returns table (outlet text, outlet_name text, night date, slots text[])
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select o.code, o.name, d::date,
         array(select to_char(s at time zone h.timezone, 'HH24:MI')
                 from app.table_slots(o.id, d::date) s
                where s > now()
                  and (o.closed_until is null or s >= o.closed_until)
                order by s)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join reservations r on r.id = v.reservation_id and r.status in ('confirmed', 'checked_in')
    join hotels h on h.id = v.hotel_id
    join pos_outlets o on o.hotel_id = v.hotel_id and o.is_active and o.category = 'food'
   cross join lateral generate_series(
           greatest(r.check_in, (now() at time zone h.timezone)::date),
           r.check_out - 1, interval '1 day') d
   where app.module_enabled(v.hotel_id, 'pos')
     and exists (select 1 from app.table_slots(o.id, d::date) s
                  where s > now() and (o.closed_until is null or s >= o.closed_until))
   order by o.code, d;
$fn$;

comment on function app.guest_table_offer(text, text) is
  'A guest''s table-booking choices (D27-224): each restaurant, each night of '
  'the stay from today, the half-hour slots still to come. Behind this phone''s unlock.';

/* A request for a table: only a slot the offer holds, three open at most. */
create or replace function app.guest_table_book(
  p_token_hash text, p_unlock_hash text,
  p_outlet text, p_night date, p_time text, p_party int, p_note text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
  v_outlet uuid;
  v_at timestamptz;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null or p_party is null or p_party not between 1 and 20
     or char_length(coalesce(p_note, '')) > 200 then
    return false;
  end if;

  /* The slot must be one the offer holds, for this stay - nothing else. */
  select o.id, (p_night + p_time::time) at time zone h.timezone into v_outlet, v_at
    from app.guest_table_offer(p_token_hash, p_unlock_hash) f
    join pos_outlets o on o.hotel_id = v.hotel_id and o.code = f.outlet
    join hotels h on h.id = v.hotel_id
   where f.outlet = upper(p_outlet) and f.night = p_night
     and p_time = any(f.slots);
  if v_outlet is null then
    return false;
  end if;

  if (select count(*) from table_bookings
       where reservation_id = v.reservation_id
         and (status = 'requested' or (status = 'confirmed' and at > now()))) >= 3 then
    return false;
  end if;

  insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at, note)
  values (v.hotel_id, v_outlet, v.reservation_id, p_party, v_at, nullif(btrim(p_note), ''));
  return true;
end
$fn$;

comment on function app.guest_table_book(text, text, text, date, text, int, text) is
  'A guest asks for a table (D27-224): a slot from app.guest_table_offer, a party '
  'of 1 to 20, a note of 200 characters at most, three open at most. Behind this '
  'phone''s unlock; false for anything else.';

/* What this guest has asked for - never the table, which is the staff's. */
create or replace function app.guest_table_bookings_mine(p_token_hash text, p_unlock_hash text)
returns table (id uuid, outlet_name text, night date, at_time text, party smallint,
               note text, status text, answer text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select b.id, o.name, (b.at at time zone h.timezone)::date,
         to_char(b.at at time zone h.timezone, 'HH24:MI'), b.party, b.note, b.status,
         case when b.status = 'declined' then b.answer end
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join table_bookings b on b.reservation_id = v.reservation_id
    join pos_outlets o on o.id = b.outlet_id
    join hotels h on h.id = b.hotel_id
   order by b.at;
$fn$;

comment on function app.guest_table_bookings_mine(text, text) is
  'A guest''s own table requests and their answers - the time and the party, '
  'never the table (D27-224). Behind this phone''s unlock.';

/* Cancelled by the guest - only while nobody has answered. */
create or replace function app.guest_table_cancel(p_token_hash text, p_unlock_hash text, p_booking uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
  n int;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null then
    return false;
  end if;
  update table_bookings set status = 'cancelled'
   where id = p_booking and reservation_id = v.reservation_id and status = 'requested';
  get diagnostics n = row_count;
  return n = 1;
end
$fn$;

comment on function app.guest_table_cancel(text, text, uuid) is
  'A guest cancels their own table request, only while it is still requested '
  '(D27-224). Behind this phone''s unlock.';

revoke all on function app.guest_table_offer(text, text) from public;
revoke all on function app.guest_table_book(text, text, text, date, text, int, text) from public;
revoke all on function app.guest_table_bookings_mine(text, text) from public;
revoke all on function app.guest_table_cancel(text, text, uuid) from public;
grant execute on function app.guest_table_offer(text, text) to pms_app;
grant execute on function app.guest_table_book(text, text, text, date, text, int, text) to pms_app;
grant execute on function app.guest_table_bookings_mine(text, text) to pms_app;
grant execute on function app.guest_table_cancel(text, text, uuid) to pms_app;
