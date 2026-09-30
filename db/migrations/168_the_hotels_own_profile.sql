-- =============================================================================
-- 168 — the hotel's own profile, and who may write it (D27-213, D27-214)
-- =============================================================================
-- The owner, 30 September and 1 October: one place for settings, and a hotel's
-- GM and Admin may edit their OWN hotel's details. Three things, all additive,
-- re-runnable, and nothing already typed is changed.
--
--   1  who may write a hotel's row            a finding, fixed first (D27-214)
--   2  the profile's missing fields           all NULL until somebody types one
--   3  a hotel's own logo                     its own table, the group logo's limits
--   4  the map point and PIN come home        copied from the channel manager's
--                                             setup where the hotel has none
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · a hotel's row is written by whoever manages THAT hotel
-- -----------------------------------------------------------------------------
-- 013's policy asked app.is_manager(): a group administrator, or an owner or GM
-- at ANY hotel. Two faults in one line:
--
--   * the hotel-level ADMIN role is not in it, so an Admin saving the FSSAI
--     number or the front desk's hours wrote nothing - UPDATE 0, and the route
--     said "No such property" (proved on 1 October in a rolled-back transaction);
--   * a GM of one hotel who also works at another in a lesser role could write
--     the other's row.
--
-- app.manages_hotel (084) is the question that was meant: a group
-- administrator, or owner, GM or Admin AT THIS HOTEL.
-- -----------------------------------------------------------------------------
drop policy if exists hotels_manage on hotels;
create policy hotels_manage on hotels
  for update
  using      ( app.manages_hotel(id) )
  with check ( app.manages_hotel(id) );


-- -----------------------------------------------------------------------------
-- 2 · the profile's missing fields
-- -----------------------------------------------------------------------------
-- NULL is "nobody has said": a dash on the screen, nothing on a document.
-- The shapes are the database's backstop; the server says why in a sentence.
-- PAN, the reservations phone and the website are STORED and printed nowhere
-- until the owner says where (D27-214).
-- -----------------------------------------------------------------------------
alter table hotels add column if not exists address_line_2     text;
alter table hotels add column if not exists pin                text;
alter table hotels add column if not exists website            text;
alter table hotels add column if not exists pan                text;
alter table hotels add column if not exists reservations_phone text;
alter table hotels add column if not exists property_type      text;
alter table hotels add column if not exists star_rating        smallint;
alter table hotels add column if not exists latitude           numeric(9,6);
alter table hotels add column if not exists longitude          numeric(9,6);

alter table hotels drop constraint if exists hotels_pin_shape;
alter table hotels add constraint hotels_pin_shape
  check (pin is null or pin ~ '^[1-9][0-9]{5}$');

alter table hotels drop constraint if exists hotels_pan_shape;
alter table hotels add constraint hotels_pan_shape
  check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

/* The owner's list (D27-214). A word here, its label on the screen. */
alter table hotels drop constraint if exists hotels_property_type_known;
alter table hotels add constraint hotels_property_type_known
  check (property_type is null or property_type in (
    'hotel', 'resort', 'boutique_hotel', 'heritage_hotel', 'homestay',
    'villa', 'serviced_apartment', 'guest_house', 'other'));

alter table hotels drop constraint if exists hotels_star_rating_sane;
alter table hotels add constraint hotels_star_rating_sane
  check (star_rating is null or star_rating between 1 and 5);

/* A map point is two figures or none, and on the globe. */
alter table hotels drop constraint if exists hotels_map_point_whole;
alter table hotels add constraint hotels_map_point_whole check (
  (latitude is null) = (longitude is null)
  and (latitude is null
       or (latitude between -90 and 90 and longitude between -180 and 180)));

comment on column hotels.pin is
  'The postal index number, six digits. With the map point, what the channel '
  'manager sends as the hotel''s place (D27-214).';
comment on column hotels.pan is
  'The hotel''s PAN. Stored; printed nowhere until the owner says where.';


-- -----------------------------------------------------------------------------
-- 3 · a hotel's own logo
-- -----------------------------------------------------------------------------
-- Its own table, not a column on `hotels`: that row is read whole by nearly
-- every screen, and 200 KB of picture has no business riding along. The same
-- limits as the group's logo (148): a PNG or an SVG, 200 KB at most; the server
-- checks the file by its content. No row: the group's logo prints (D27-214).
-- -----------------------------------------------------------------------------
create table if not exists hotel_logos (
  hotel_id    uuid primary key references hotels(id) on delete cascade,
  logo_type   text  not null,
  logo        bytea not null,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),

  constraint hotel_logos_type check (logo_type in ('image/png', 'image/svg+xml')),
  constraint hotel_logos_size check (octet_length(logo) between 1 and 204800)
);

comment on table hotel_logos is
  'A hotel''s own logo (D27-214): printed on that hotel''s guest documents '
  'when it has one, the group''s when it has not. At most one row a hotel.';

alter table hotel_logos enable row level security;
alter table hotel_logos force  row level security;

/* Read by everybody who works there: they print the bills. */
drop policy if exists hotel_logos_read on hotel_logos;
create policy hotel_logos_read on hotel_logos
  for select using ( hotel_id in (select app.auth_hotel_ids()) );

/* Written by whoever manages that hotel, as its row is. */
drop policy if exists hotel_logos_write on hotel_logos;
create policy hotel_logos_write on hotel_logos
  for all
  using      ( app.manages_hotel(hotel_id) )
  with check ( app.manages_hotel(hotel_id) );

grant select, insert, update, delete on hotel_logos to pms_app;


-- -----------------------------------------------------------------------------
-- 4 · the map point and the PIN come home
-- -----------------------------------------------------------------------------
-- They were typed inside the channel manager's setup (channel_hotels). They
-- are the hotel's, so they are copied to it - ONLY where the hotel has none of
-- its own, so a second run and a figure typed since both stand. channel_hotels
-- keeps its columns; the channel manager reads the hotel's first and its own
-- where the hotel still has none, so nothing already set up is lost.
-- A postcode that is not six digits is left where it is, not forced in.
-- -----------------------------------------------------------------------------
update hotels h
   set latitude  = round(c.latitude, 6),
       longitude = round(c.longitude, 6)
  from channel_hotels c
 where c.hotel_id = h.id
   and h.latitude is null
   and c.latitude  between -90  and 90
   and c.longitude between -180 and 180;

update hotels h
   set pin = btrim(c.postal_code)
  from channel_hotels c
 where c.hotel_id = h.id
   and h.pin is null
   and btrim(c.postal_code) ~ '^[1-9][0-9]{5}$';
