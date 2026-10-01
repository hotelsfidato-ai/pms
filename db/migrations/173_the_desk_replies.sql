-- =============================================================================
-- 173 · The front desk replies to the guest (D27-224)
-- =============================================================================
-- The owner, 1 October, accepting the plan's recommendations: the desk's own
-- roles reply (DESK_ROLES); the guest sees "Front desk", never a name; no
-- WhatsApp alert; no reply once the guest has checked out.
--
-- A reply belongs to the STAY, like the guest's own messages (132): the next
-- guest in the room reaches another stay and so sees none of it. Written by
-- the desk under its own session (RLS by hotel); read by the guest only
-- through `app.guest_desk_thread`, which asks `app.guest_unlocked` like every
-- function behind the code. Nothing earlier is changed (MEMORY 317).
-- =============================================================================

create table if not exists guest_desk_replies (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id),
  reservation_id uuid not null references reservations(id) on delete cascade,
  what           text not null,
  sent_by        uuid not null references staff(id),
  sent_at        timestamptz not null default now(),

  constraint gdr_what_sane check (length(trim(what)) between 1 and 500)
);

comment on table guest_desk_replies is
  'The front desk''s reply to a guest''s message from their own page (D27-224). '
  'The guest sees it as "Front desk"; who sent it is for the desk only.';

create index if not exists guest_desk_replies_by_stay
  on guest_desk_replies (reservation_id, sent_at);

alter table guest_desk_replies enable row level security;
alter table guest_desk_replies force  row level security;
drop policy if exists guest_desk_replies_by_hotel on guest_desk_replies;
create policy guest_desk_replies_by_hotel on guest_desk_replies
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, insert on guest_desk_replies to pms_app;

-- The guest's conversation with the desk: their own messages (132) and the
-- desk's replies, newest first. `from_desk` is all the guest learns of who.
create or replace function app.guest_desk_thread(p_token_hash text, p_unlock_hash text)
returns table (from_desk boolean, what text, status text, at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select false, q.what, q.status, q.created_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guest_requests q on q.reservation_id = v.reservation_id and q.kind = 'desk'
  union all
  select true, d.what, null, d.sent_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guest_desk_replies d on d.reservation_id = v.reservation_id
   order by 4 desc;
$fn$;

comment on function app.guest_desk_thread(text, text) is
  'The guest''s messages to the desk and its replies, for the one stay this '
  'link and this phone''s unlock reach (D27-224). No staff name.';

revoke all on function app.guest_desk_thread(text, text) from public;
grant execute on function app.guest_desk_thread(text, text) to pms_app;
