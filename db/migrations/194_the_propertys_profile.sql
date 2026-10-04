-- =============================================================================
-- 194 · The property's profile: numbers, texts, amenities, child ages
--       (D27-249, D27-257; phase 2 of the settings plan; numbered for now)
-- =============================================================================
-- The owner, 3 October, every recommendation accepted (D27-257):
--   · up to four more registration numbers, each with its own label - in
--     Settings only, never printed (GSTIN and PAN already are);
--   · the hotel's texts: five HIGHLIGHTS (about, attractions, directions,
--     activities, landmarks) and three POLICIES (parking, family and extra
--     guest, reservation terms) - plain text, paragraphs kept, nothing else;
--   · ONE amenities list for the whole group (`amenities`, a name phase 3's
--     room_type_amenities points at), added to and renamed by the owner or an
--     Admin; each hotel's GM switches theirs on (`hotel_amenities`). About
--     twenty common names are seeded, every hotel starting with none on;
--   · the child age policy as WORDS ONLY: free up to one age, a child up to
--     another. Prices do not read them (app.tariff_for is unchanged).
-- The guest's page shows the highlights, the amenities and the map point
-- behind the code (online-checkin's rule 8): app.guest_about.
-- The reset (api/scripts/reset-property.ts) keeps all of it: settings.
-- New columns, tables and functions only; nothing earlier is changed.
-- =============================================================================

-- 1 · Four more registration numbers, and the child ages, on the hotel ------
alter table hotels add column if not exists extra_registrations jsonb not null default '[]'::jsonb;
alter table hotels add column if not exists child_free_age smallint;
alter table hotels add column if not exists child_max_age  smallint;

create or replace function app.registrations_ok(p jsonb)
returns boolean
language sql immutable
set search_path = pg_catalog
as $fn$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 4
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or char_length(btrim(coalesce(e->>'label', ''))) not between 1 and 40
           or char_length(btrim(coalesce(e->>'number', ''))) not between 1 and 40);
$fn$;

alter table hotels drop constraint if exists hotels_extra_registrations;
alter table hotels add constraint hotels_extra_registrations check (app.registrations_ok(extra_registrations));
alter table hotels drop constraint if exists hotels_child_ages;
alter table hotels add constraint hotels_child_ages check (
  (child_free_age is null or child_free_age between 0 and 17)
  and (child_max_age is null or child_max_age between 1 and 17)
  and (child_free_age is null or child_max_age is null or child_free_age < child_max_age));

comment on column hotels.extra_registrations is
  'Up to four more registration numbers, [{label, number}] (D27-257). Settings only.';
comment on column hotels.child_free_age is
  'Children up to this age stay free - in words only; prices do not read it (D27-257).';
comment on column hotels.child_max_age is
  'A child up to this age; older is an adult - in words only (D27-257).';


-- 2 · The hotel's texts ------------------------------------------------------
create table if not exists hotel_texts (
  hotel_id    uuid not null references hotels(id) on delete cascade,
  kind        text not null,
  body        text not null,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),
  primary key (hotel_id, kind),
  constraint hotel_texts_kind check (kind in (
    'about', 'attractions', 'directions', 'activities', 'landmarks',
    'parking', 'family', 'reservation_terms')),
  constraint hotel_texts_body check (char_length(btrim(body)) between 1 and 2000)
);

comment on table hotel_texts is
  'A hotel''s highlights and policy texts (D27-257), plain text. No row: not written.';

alter table hotel_texts enable row level security;
alter table hotel_texts force  row level security;
drop policy if exists hotel_texts_read on hotel_texts;
create policy hotel_texts_read on hotel_texts
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists hotel_texts_write on hotel_texts;
create policy hotel_texts_write on hotel_texts
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update, delete on hotel_texts to pms_app;


-- 3 · ONE amenities list for the group, and each hotel's -------------------
/* The owner or an Admin keeps the list (D27-257): a group administrator, or
   whoever is owner or Admin at any hotel. */
create or replace function app.keeps_amenities()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $fn$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
     where sh.staff_id = app.current_user_id() and sh.role in ('owner', 'admin'));
$fn$;
revoke all on function app.keeps_amenities() from public;
grant execute on function app.keeps_amenities() to pms_app;

create table if not exists amenities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text not null default 'other',
  position    int  not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  constraint amenities_name check (char_length(btrim(name)) between 1 and 40),
  constraint amenities_icon check (icon ~ '^[a-z-]{1,30}$')
);
create unique index if not exists amenities_name_once on amenities (lower(btrim(name)));

comment on table amenities is
  'ONE amenities list for the group (D27-257): each hotel switches on its own '
  '(hotel_amenities), and each room type its own (phase 3, room_type_amenities).';

alter table amenities enable row level security;
alter table amenities force  row level security;
drop policy if exists amenities_read on amenities;
create policy amenities_read on amenities for select using ( app.current_user_id() is not null );
drop policy if exists amenities_write on amenities;
create policy amenities_write on amenities
  for all using ( app.keeps_amenities() ) with check ( app.keeps_amenities() );
grant select, insert, update, delete on amenities to pms_app;

create table if not exists hotel_amenities (
  hotel_id    uuid not null references hotels(id) on delete cascade,
  amenity_id  uuid not null references amenities(id),
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),
  primary key (hotel_id, amenity_id)
);

alter table hotel_amenities enable row level security;
alter table hotel_amenities force  row level security;
drop policy if exists hotel_amenities_read on hotel_amenities;
create policy hotel_amenities_read on hotel_amenities
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists hotel_amenities_write on hotel_amenities;
create policy hotel_amenities_write on hotel_amenities
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update, delete on hotel_amenities to pms_app;

/* Names only, no prices; every hotel starts with none switched on. */
insert into amenities (name, icon, position)
select v.name, v.icon, v.position from (values
  ('24-hour front desk', 'front-desk', 10), ('Air conditioning', 'ac', 20),
  ('Free Wi-Fi', 'wifi', 30), ('Parking', 'parking', 40),
  ('Restaurant', 'restaurant', 50), ('Room service', 'room-service', 60),
  ('Breakfast', 'breakfast', 70), ('Laundry', 'laundry', 80),
  ('Lift', 'lift', 90), ('Power backup', 'power', 100),
  ('Hot water', 'hot-water', 110), ('Television', 'tv', 120),
  ('Banquet hall', 'banquet', 130), ('Swimming pool', 'pool', 140),
  ('Gym', 'gym', 150), ('Spa', 'spa', 160), ('Bar', 'bar', 170),
  ('CCTV', 'cctv', 180), ('Doctor on call', 'doctor', 190),
  ('Airport pickup', 'pickup', 200)
) as v(name, icon, position)
where not exists (select 1 from amenities a where lower(btrim(a.name)) = lower(v.name));


-- 4 · Recorded, as every setting is ----------------------------------------
drop trigger if exists hotel_texts_audit on hotel_texts;
create trigger hotel_texts_audit after insert or update or delete on hotel_texts
  for each row execute function app.write_audit();
drop trigger if exists amenities_audit on amenities;
create trigger amenities_audit after insert or update or delete on amenities
  for each row execute function app.write_audit();
drop trigger if exists hotel_amenities_audit on hotel_amenities;
create trigger hotel_amenities_audit after insert or update or delete on hotel_amenities
  for each row execute function app.write_audit();


-- 5 · The guest's page: behind the code (online-checkin rule 8) -------------
create or replace function app.guest_about(p_token_hash text, p_unlock_hash text)
returns table (texts jsonb, amenities jsonb, latitude numeric, longitude numeric)
language sql stable security definer
set search_path = pg_catalog, public
as $fn$
  select
    coalesce((select jsonb_object_agg(t.kind, t.body) from hotel_texts t
               where t.hotel_id = v.hotel_id
                 and t.kind in ('about', 'attractions', 'directions', 'activities', 'landmarks')),
             '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'icon', a.icon) order by a.position, a.name)
                from hotel_amenities ha join amenities a on a.id = ha.amenity_id and a.is_active
               where ha.hotel_id = v.hotel_id), '[]'::jsonb),
    h.latitude, h.longitude
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join hotels h on h.id = v.hotel_id;
$fn$;

comment on function app.guest_about(text, text) is
  'The hotel''s highlights, its amenities and its map point for the guest''s page '
  '(D27-257). Behind this phone''s unlock; no row without it.';

revoke all on function app.guest_about(text, text) from public;
grant execute on function app.guest_about(text, text) to pms_app;
