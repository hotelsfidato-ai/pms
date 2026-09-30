-- =============================================================================
-- 167 · Three ways to prove it is you: the code by email, and Google; and
--       where a guest's ID photo is kept (D27-207 to D27-212)
-- =============================================================================
-- The guest's own door (114, 121, 158) took one proof: six digits sent on
-- WhatsApp to the number the booking carries. The owner adds two, the guest's
-- choice, and nothing is sent until they choose (D27-210):
--
--   · THE CODE BY EMAIL, to the email THE STAY carries. Nobody types an
--     address. The same table, the same rules: only the hash is kept, ten
--     minutes, five wrong answers, one live code per link - so
--     `app.guest_code_answer` (158) accepts it unchanged and hands out the
--     same unlock.
--   · CONTINUE WITH GOOGLE. The door checks Google's signed answer; THIS file
--     compares the address Google vouches for with the stay's own, here in the
--     database, and records the same unlock. No account, no session, no guest
--     role (the door's rule 1).
--
-- Every function here is NEW. None changes the signature or the return type of
-- a function an earlier migration makes (MEMORY 317): every deploy replays
-- from 001. That is why the email's hint has its own function and is not a new
-- column of `app.guest_link_open` (121).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · An email address as the page may show it
-- -----------------------------------------------------------------------------
-- The first letter and the domain: enough for its owner to know which inbox,
-- not enough to write to it. Null for anything that is not an address, so a
-- typing slip on the booking is "no email", never half of one on a screen.
create or replace function app.masked_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select case
    when btrim(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then left(btrim(p_email), 1) || '…@' || split_part(btrim(p_email), '@', 2)
  end;
$fn$;

revoke all on function app.masked_email(text) from public;

-- -----------------------------------------------------------------------------
-- 2 · What a booking's link may say about the email, before the code
-- -----------------------------------------------------------------------------
-- A booking's own link shows the guest their name and the last digits of
-- their number already; the masked email is the same kind of fact. A ROOM CARD
-- SHOWS NOTHING OF THE GUEST (D21-14): null, whoever is in the room.
create or replace function app.guest_link_ways(p_token_hash text)
returns table (email_hint text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select case when s.room_id is null then app.masked_email(g.email::text) end
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;
$fn$;

comment on function app.guest_link_ways(text) is
  'The masked email a booking''s link may show before the code (D27-207). Null '
  'on a room card, which shows nothing of the guest (D21-14), and where the '
  'booking carries no address.';

revoke all on function app.guest_link_ways(text) from public;
grant execute on function app.guest_link_ways(text) to pms_app;

-- -----------------------------------------------------------------------------
-- 3 · The code, to the email the stay carries
-- -----------------------------------------------------------------------------
-- 158's `app.guest_code_make`, for the other address. A stay with no email
-- answers a row with no code, and nothing is issued - the page says "Ask the
-- desk". A new code ends the one before it, whichever way that one went.
create or replace function app.guest_email_code_make(p_token_hash text)
returns table (code text, sent_to text, email text, reservation_id uuid, reference text,
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
  v_email text;
  v_code  text;
begin
  select s.link_id, s.reservation_id, s.room_id is not null, btrim(g.email::text)
    into v_link, v_stay, v_room, v_email
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null then
    return;                                     -- nothing, and nothing said
  end if;

  if app.masked_email(v_email) is null then
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
          app.masked_email(v_email),
          now() + interval '10 minutes');

  return query
    select v_code, app.masked_email(v_email), v_email, r.id, r.reference, g.full_name,
           h.id, h.code, h.name, v_room
      from reservations r
      join guests g on g.id = r.guest_id
      join hotels h on h.id = r.hotel_id
     where r.id = v_stay;
end
$fn$;

comment on function app.guest_email_code_make(text) is
  'A six-digit code for the email THE STAY carries (D27-207): no address is '
  'typed. A stay with no email answers a row with no code, and nothing is issued.';

revoke all on function app.guest_email_code_make(text) from public;
grant execute on function app.guest_email_code_make(text) to pms_app;

-- -----------------------------------------------------------------------------
-- 4 · Google's answer: the address it vouches for must be the stay's own
-- -----------------------------------------------------------------------------
-- The door has already checked that Google signed the answer, for this system,
-- just now, for a verified address. What is decided HERE is whose booking it
-- is: the address must be the one the stay carries, letter case aside. Then
-- the same unlock as a right code (158): this phone, this link, this stay, a
-- day. A wrong address, a stay with none, a dead link: false, and nothing
-- written.
create or replace function app.guest_google_answer(
  p_token_hash text, p_email text, p_unlock_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid;
  v_stay uuid;
  v_same boolean;
begin
  if coalesce(length(p_unlock_hash), 0) <> 64 or coalesce(btrim(p_email), '') = '' then
    return false;
  end if;

  select s.link_id, s.reservation_id,
         lower(btrim(g.email::text)) = lower(btrim(p_email))
    into v_link, v_stay, v_same
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null or v_same is not true then
    return false;
  end if;

  update guest_links set verified_at = now() where id = v_link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (v_link, v_stay, p_unlock_hash, now() + interval '24 hours');
  return true;
end
$fn$;

comment on function app.guest_google_answer(text, text, text) is
  'Continue with Google (D27-207): true, and this phone unlocked for a day, '
  'only when the address Google vouched for is the one the stay carries.';

revoke all on function app.guest_google_answer(text, text, text) from public;
grant execute on function app.guest_google_answer(text, text, text) to pms_app;

-- =============================================================================
-- THE ID PHOTO (D27-207 to D27-212)
-- =============================================================================
-- A guest may add a photo of their ID (front, and back if it has one) after
-- sending their details; the desk may add one at check-in for a guest who did
-- not. It stays a SUBMISSION (D21-8): nothing here reaches guest_documents,
-- Form C or Form III.
--
-- ⚠ THE PHOTO IS NEVER ON THIS SERVER (D27-209). It is encrypted here with
-- that hotel's own password and stored in Google Drive; this table holds where
-- it is and what it must hash to, and nothing of the image: no bytes, no
-- file name, no path.
--
--   pending   the row is written FIRST, so a file that reached Drive always
--             has a row to be found by (the file is named by this id)
--   stored    Drive has it: its file id, and the sha256 and size of the
--             encrypted bundle, checked again every time it is fetched
--   removed   a person removed it (who, when, why) or the guest replaced it;
--             the Drive file is deleted, or `drive_delete_failed_at` says it
--             has not been yet
--
-- ONE ID PER STAY for the launch, the booking's guest (D27-212). `guest_id`
-- is on the row so a later "one per adult" is more rows, not another table.

-- -----------------------------------------------------------------------------
-- 5 · The table
-- -----------------------------------------------------------------------------
create table if not exists guest_id_photos (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id),
  -- A copy at upload: the password and the Drive folder are chosen by code.
  hotel_code      text not null,
  reservation_id  uuid not null references reservations(id),
  guest_id        uuid not null references guests(id),
  -- The details it was sent with; null for a photo the desk added.
  submission_id   uuid references guest_detail_submissions(id) on delete set null,

  -- WHO PUT IT THERE: the guest, through their own link, or a clerk.
  link_id         uuid references guest_links(id) on delete set null,
  uploaded_by     uuid references staff(id),

  sides           text[] not null,
  -- The words the guest (or the desk, for the guest) agreed to, and when.
  notice_version  text not null,
  consented_at    timestamptz not null default now(),

  status          text not null default 'pending',
  created_at      timestamptz not null default now(),
  stored_at       timestamptz,
  drive_file_id   text,
  cipher_sha256   text,
  cipher_bytes    integer,

  removed_at      timestamptz,
  removed_by      uuid references staff(id),
  removed_reason  text,
  drive_delete_failed_at timestamptz,

  constraint gip_status_valid check (status in ('pending', 'stored', 'removed')),
  constraint gip_sides_valid check (
    sides <@ array['front', 'back'] and 'front' = any(sides) and cardinality(sides) between 1 and 2),
  constraint gip_one_source check ((link_id is not null) <> (uploaded_by is not null)
    or (link_id is null and uploaded_by is null and status <> 'pending')),
  constraint gip_stored_says_where check (
    status = 'pending' or (drive_file_id is not null and stored_at is not null
      and cipher_sha256 ~ '^[0-9a-f]{64}$' and cipher_bytes > 0)),
  constraint gip_removed_says_why check (
    (status = 'removed') = (removed_at is not null and removed_reason is not null))
);

comment on table guest_id_photos is
  'Where a guest''s ID photo is (D27-207 to D27-212): an encrypted bundle in '
  'Google Drive, never on this server. One row per bundle; the image itself is '
  'nowhere in this database.';

create index if not exists guest_id_photos_by_stay
  on guest_id_photos (reservation_id, created_at desc);
create index if not exists guest_id_photos_by_hotel
  on guest_id_photos (hotel_id, status, created_at desc);

alter table guest_id_photos enable row level security;
alter table guest_id_photos force  row level security;
drop policy if exists guest_id_photos_by_hotel on guest_id_photos;
create policy guest_id_photos_by_hotel on guest_id_photos
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
-- A row is never deleted once Drive holds its file: only an upload that did
-- not reach Drive is taken back.
drop policy if exists guest_id_photos_only_pending_go on guest_id_photos;
create policy guest_id_photos_only_pending_go on guest_id_photos
  as restrictive for delete
  using ( status = 'pending' );
-- WHICH staff (the desk; owner, Admin and GM for a kept one) is the route's
-- rule (routes/guestDoor.ts). The guest's own upload is the definer functions
-- below, never a bare insert.
grant select, insert, update, delete on guest_id_photos to pms_app;

-- EVERY VIEW IS WRITTEN DOWN (D27-210): who opened which photo, and when.
create table if not exists guest_id_photo_views (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id),
  photo_id   uuid not null references guest_id_photos(id),
  viewed_by  uuid not null references staff(id),
  viewed_at  timestamptz not null default now()
);

comment on table guest_id_photo_views is
  'One row each time a member of staff opens a guest''s ID photo (D27-210).';

create index if not exists guest_id_photo_views_by_photo
  on guest_id_photo_views (photo_id, viewed_at desc);

alter table guest_id_photo_views enable row level security;
alter table guest_id_photo_views force  row level security;
drop policy if exists guest_id_photo_views_by_hotel on guest_id_photo_views;
create policy guest_id_photo_views_by_hotel on guest_id_photo_views
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
-- Written and read; never changed, never deleted.
grant select, insert on guest_id_photo_views to pms_app;

-- -----------------------------------------------------------------------------
-- 6 · The guest's own upload - behind the code, every function
-- -----------------------------------------------------------------------------
-- Each takes the link's hash AND this phone's unlock, and asks
-- `app.guest_unlocked` itself (D21-6, OCI-5). The link alone does nothing.

-- BEGIN: the row, before anything goes to Drive. Only with details waiting
-- for the desk: the photo is part of that submission, and once a clerk has
-- confirmed or set it aside the guest adds nothing more. Answers what the
-- bundle's own description needs, and nothing when refused.
create or replace function app.guest_id_photo_begin(
  p_token_hash text, p_unlock_hash text, p_sides text[], p_notice text)
returns table (id uuid, hotel_id uuid, hotel_code text, reference text, guest_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v    record;
  v_submission uuid;
  v_id uuid;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null or coalesce(btrim(p_notice), '') = '' then
    return;
  end if;
  select d.id into v_submission
    from guest_detail_submissions d
   where d.reservation_id = v.reservation_id and d.status = 'waiting';
  if v_submission is null then
    return;
  end if;

  -- An upload that never finished (the server stopped between this row and
  -- Drive) is not left behind for ever.
  delete from guest_id_photos p
   where p.reservation_id = v.reservation_id and p.status = 'pending'
     and p.created_at < now() - interval '10 minutes';

  insert into guest_id_photos
    (hotel_id, hotel_code, reservation_id, guest_id, submission_id, link_id, sides, notice_version)
  select v.hotel_id, h.code, v.reservation_id, v.guest_id, v_submission, v.link_id, p_sides, btrim(p_notice)
    from hotels h where h.id = v.hotel_id
  returning guest_id_photos.id into v_id;

  return query
    select v_id, h.id, h.code, r.reference, g.full_name
      from reservations r
      join guests g on g.id = r.guest_id
      join hotels h on h.id = r.hotel_id
     where r.id = v.reservation_id;
end
$fn$;

comment on function app.guest_id_photo_begin(text, text, text[], text) is
  'The guest''s ID photo, step one (D27-209): a pending row, only behind the '
  'code and only while their details wait for the desk.';

revoke all on function app.guest_id_photo_begin(text, text, text[], text) from public;
grant execute on function app.guest_id_photo_begin(text, text, text[], text) to pms_app;

-- STORED: Drive has it. The bundle before it, if the guest sent one, is
-- marked replaced here and handed back so its Drive file can be deleted at
-- once - an unmasked Aadhaar replaced by a masked one must not stay.
--
-- ⚠ ONLY THE GUEST'S OWN, WAITING, OF THE SAME SUBMISSION (1 October, found by
-- the pre-launch review). It replaced EVERY stored photo of the stay: a guest
-- who sent their details again - a new waiting submission - and any JPEG
-- with it deleted the copy the desk had already confirmed, and a desk that
-- then removed the new one as "not an ID" left none at all. A KEPT photo
-- (confirmed, set aside, or added at the desk) is deleted only by the owner,
-- an administrator or the GM, with a reason (D27-210) - never by a replace.
create or replace function app.guest_id_photo_stored(
  p_token_hash text, p_unlock_hash text, p_id uuid,
  p_drive_file_id text, p_sha256 text, p_bytes integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
  v_replaced jsonb;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null then
    return null;
  end if;

  update guest_id_photos
     set status = 'stored', stored_at = now(), drive_file_id = p_drive_file_id,
         cipher_sha256 = p_sha256, cipher_bytes = p_bytes
   where id = p_id and reservation_id = v.reservation_id and status = 'pending';
  if not found then
    return null;
  end if;

  with gone as (
    update guest_id_photos
       set status = 'removed', removed_at = now(), removed_reason = 'replaced'
     where reservation_id = v.reservation_id and guest_id = v.guest_id
       and status = 'stored' and id <> p_id
       and link_id is not null
       and submission_id = (select submission_id from guest_id_photos where id = p_id)
    returning id, drive_file_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'driveFileId', drive_file_id)), '[]'::jsonb)
    into v_replaced from gone;

  return jsonb_build_object('replaced', v_replaced);
end
$fn$;

revoke all on function app.guest_id_photo_stored(text, text, uuid, text, text, integer) from public;
grant execute on function app.guest_id_photo_stored(text, text, uuid, text, text, integer) to pms_app;

-- ABANDON: Drive could not be reached, so nothing is kept anywhere.
create or replace function app.guest_id_photo_abandon(
  p_token_hash text, p_unlock_hash text, p_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  delete from guest_id_photos p
   using app.guest_unlocked(p_token_hash, p_unlock_hash) v
   where p.id = p_id and p.reservation_id = v.reservation_id and p.status = 'pending';
$fn$;

revoke all on function app.guest_id_photo_abandon(text, text, uuid) from public;
grant execute on function app.guest_id_photo_abandon(text, text, uuid) to pms_app;

-- A replaced bundle whose Drive file could not be deleted: written down, so
-- a manager sees it and tries again.
create or replace function app.guest_id_photo_delete_failed(
  p_token_hash text, p_unlock_hash text, p_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  update guest_id_photos p
     set drive_delete_failed_at = now()
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
   where p.id = p_id and p.reservation_id = v.reservation_id and p.status = 'removed';
$fn$;

revoke all on function app.guest_id_photo_delete_failed(text, text, uuid) from public;
grant execute on function app.guest_id_photo_delete_failed(text, text, uuid) to pms_app;

-- WHAT THE GUEST MAY KNOW of their own photo: that it is there and since
-- when, or that the desk removed it and why. Never the image, never where it
-- is kept.
create or replace function app.guest_id_photo_state(p_token_hash text, p_unlock_hash text)
returns table (status text, sides text[], stored_at timestamptz, removed_reason text,
               may_send boolean, hotel_phone text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select p.status, p.sides, p.stored_at, p.removed_reason,
         exists (select 1 from guest_detail_submissions d
                  where d.reservation_id = v.reservation_id and d.status = 'waiting'),
         -- Whom to ask to have it deleted: the notice names the hotel's own number.
         (select nullif(btrim(h.phone), '') from hotels h where h.id = v.hotel_id)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    left join lateral (
      select * from guest_id_photos x
       where x.reservation_id = v.reservation_id and x.guest_id = v.guest_id
         and x.status <> 'pending'
         and not (x.status = 'removed' and x.removed_reason = 'replaced')
       order by x.created_at desc
       limit 1) p on true;
$fn$;

comment on function app.guest_id_photo_state(text, text) is
  'Behind the code: whether the guest''s ID photo is there, or was removed and '
  'why, and whether they may send one now. Nothing of the image.';

revoke all on function app.guest_id_photo_state(text, text) from public;
grant execute on function app.guest_id_photo_state(text, text) to pms_app;
