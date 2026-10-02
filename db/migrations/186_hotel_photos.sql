-- =============================================================================
-- 186 · A photo gallery per hotel (D27-243, D27-244)
-- =============================================================================
-- The owner, 2 October: each hotel keeps its own photos, uploaded on Settings
-- → Property by the owner, an administrator or that hotel's GM, and shown on
-- the guest's in-stay page. Kept HERE, in Postgres, so the nightly dump and
-- its restore test carry them (the uploads folder is in no backup).
--
-- The page makes a photo small before it is sent and the server is the guard
-- (api/src/modules/admin/gallery.ts): a JPEG by its own bytes, the camera's
-- Exif taken out, at most 1600 px on its long side and 600 KB, twenty a
-- hotel. The checks below are the last word on size, side and caption.
--
-- They are the HOTEL's pictures, public to whoever holds a link to it: no
-- guest is ever in one or in its caption. Two definers for the guest's door:
-- the list behind the unlock (online-checkin's rule 8), and one picture on
-- the link alone, as the logo is (174) - an <img> cannot carry the unlock.
-- New table and functions only; nothing earlier is changed (MEMORY 317).
-- The reset (api/scripts/reset-property.ts) keeps them, as it keeps the logo.
-- =============================================================================

create table if not exists hotel_photos (
  id        uuid primary key default gen_random_uuid(),
  hotel_id  uuid not null references hotels(id) on delete cascade,
  position  int  not null default 0,
  caption   text,
  photo     bytea not null,
  width     int  not null,
  height    int  not null,
  added_by  uuid references staff(id),
  added_at  timestamptz not null default now(),

  constraint hotel_photos_size    check (octet_length(photo) between 1 and 614400),
  constraint hotel_photos_side    check (width between 1 and 1600 and height between 1 and 1600),
  constraint hotel_photos_caption check (caption is null or char_length(caption) between 1 and 120)
);

create index if not exists hotel_photos_hotel on hotel_photos (hotel_id, position);

comment on table hotel_photos is
  'A hotel''s photo gallery (D27-243): JPEGs at most 1600 px and 600 KB, the '
  'camera''s Exif removed, twenty a hotel (the route counts). Shown on the '
  'guest''s page; never a guest in one.';

alter table hotel_photos enable row level security;
alter table hotel_photos force  row level security;

/* Read by everybody who works there: Settings shows them. */
drop policy if exists hotel_photos_read on hotel_photos;
create policy hotel_photos_read on hotel_photos
  for select using ( hotel_id in (select app.auth_hotel_ids()) );

/* Changed by whoever manages that hotel, as its logo is (168). */
drop policy if exists hotel_photos_write on hotel_photos;
create policy hotel_photos_write on hotel_photos
  for all
  using      ( app.manages_hotel(hotel_id) )
  with check ( app.manages_hotel(hotel_id) );

grant select, insert, update, delete on hotel_photos to pms_app;


/* The list, behind this phone's unlock: no row without it. */
create or replace function app.guest_gallery(p_token_hash text, p_unlock_hash text)
returns table (id uuid, caption text, width int, height int)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select p.id, p.caption, p.width, p.height
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join hotel_photos p on p.hotel_id = v.hotel_id
   order by p.position, p.added_at, p.id;
$fn$;

comment on function app.guest_gallery(text, text) is
  'The hotel''s photos for the guest''s page (D27-243): id, caption and size, '
  'in their order. Behind this phone''s unlock.';

/* One picture, on the link alone: only a photo of the link's own hotel. */
create or replace function app.guest_gallery_photo(p_token_hash text, p_photo uuid)
returns table (photo bytea, tag text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select p.photo, md5(p.photo)
    from app.guest_link_stay(p_token_hash) s
    join hotel_photos p on p.hotel_id = s.hotel_id and p.id = p_photo;
$fn$;

comment on function app.guest_gallery_photo(text, uuid) is
  'One of the hotel''s photos for the guest''s page (D27-243): the picture and '
  'a tag for the browser''s cache. No row for a link that does not open, or '
  'a photo of another hotel.';

revoke all on function app.guest_gallery(text, text) from public;
revoke all on function app.guest_gallery_photo(text, uuid) from public;
grant execute on function app.guest_gallery(text, text) to pms_app;
grant execute on function app.guest_gallery_photo(text, uuid) to pms_app;
