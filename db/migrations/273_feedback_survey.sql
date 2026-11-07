-- =============================================================================
-- 273 · The feedback survey after check-out (D27-383 item 10; built under D27-396)
-- =============================================================================
-- Refer to it as the migration "the feedback survey": the master renumbers at
-- the merge.
--
-- After check-out the guest's own page offers a short survey - overall 1 to 5,
-- the room, cleanliness, food and staff (each 1 to 5, each optional) and a
-- comment. Per hotel, a module switched on in Settings (`feedback_survey`):
-- an absent row reads OFF, as every module not named in app.module_enabled's
-- ON list does (239), so no hotel asks until somebody turns it on.
--
-- ONCE PER STAY, NEVER TWICE: one row per booking, the database's own unique
-- key. Written only by the guest's definer function, behind the code; staff
-- read it under row security and write nothing.
--
-- NOT REVIEW GATING. Nothing here reads a score to decide what a guest is
-- asked or sent: the review request goes whatever they answered (Google's
-- rules forbid asking for a review only of the happy ones).
-- Re-runnable.
-- =============================================================================

-- ── The module's name (178's way: added once, never narrowed on a replay) ──
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'hotel_modules'::regclass and conname = 'hotel_modules_known';
  if def not like '%''feedback_survey''%' then
    alter table hotel_modules drop constraint hotel_modules_known;
    execute 'alter table hotel_modules add constraint hotel_modules_known '
         || replace(def, 'ARRAY[', 'ARRAY[''feedback_survey''::text, ');
  end if;
end $$;

-- ── The answers ──────────────────────────────────────────────────────────────
create table if not exists guest_feedback (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  overall        smallint not null,
  room           smallint,
  cleanliness    smallint,
  food           smallint,
  staff          smallint,
  comment        text,
  answered_at    timestamptz not null default now(),
  constraint guest_feedback_once_a_stay unique (reservation_id),
  constraint guest_feedback_scores check (
        overall between 1 and 5
    and (room        is null or room        between 1 and 5)
    and (cleanliness is null or cleanliness between 1 and 5)
    and (food        is null or food        between 1 and 5)
    and (staff       is null or staff       between 1 and 5)),
  constraint guest_feedback_comment check (comment is null or char_length(btrim(comment)) between 1 and 1000)
);

comment on table guest_feedback is
  'A guest''s answer to the survey after check-out (D27-383 item 10): one per stay, written only '
  'by app.guest_survey_answer from the guest''s page. Read by the owner, an Admin and the GM.';

create index if not exists guest_feedback_by_hotel on guest_feedback (hotel_id, answered_at desc);

alter table guest_feedback enable row level security;
alter table guest_feedback force  row level security;
drop policy if exists hotel_isolation on guest_feedback;
create policy hotel_isolation on guest_feedback
  using (hotel_id in (select app.auth_hotel_ids()));
grant select on guest_feedback to pms_app;
revoke insert, update, delete on guest_feedback from pms_app;

-- A test hotel's trade, as the restaurant's requests are (212's classes).
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('guest_feedback' in d) = 0 then
    execute replace(d, $q$('pos_requests', 'trading')$q$,
                       $q$('pos_requests', 'trading'), ('guest_feedback', 'trading')$q$);
  end if;
end $$;

-- ── The guest's page, behind the code (online-checkin rule 8) ────────────────
-- Offered: switched on here, the stay checked out, not answered yet.
create or replace function app.guest_survey(p_token_hash text, p_unlock_hash text)
returns table (offered boolean, answered boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select r.status = 'checked_out' and app.module_enabled(v.hotel_id, 'feedback_survey') and f.id is null,
         f.id is not null
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join reservations r on r.id = v.reservation_id
    left join guest_feedback f on f.reservation_id = v.reservation_id;
$fn$;

-- The answer: 'saved', or why not - 'locked' (no unlock: the door answers as
-- for an unknown link), 'off', 'not_yet' (not checked out), 'answered'.
create or replace function app.guest_survey_answer(
  p_token_hash text, p_unlock_hash text,
  p_overall int, p_room int, p_cleanliness int, p_food int, p_staff int, p_comment text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v record; v_status text; v_id uuid;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null then
    return 'locked';
  end if;
  if not app.module_enabled(v.hotel_id, 'feedback_survey') then
    return 'off';
  end if;
  select status into v_status from reservations where id = v.reservation_id;
  if v_status is distinct from 'checked_out' then
    return 'not_yet';
  end if;
  insert into guest_feedback (hotel_id, reservation_id, overall, room, cleanliness, food, staff, comment)
  values (v.hotel_id, v.reservation_id, p_overall, p_room, p_cleanliness, p_food, p_staff,
          nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (reservation_id) do nothing
  returning id into v_id;
  return case when v_id is null then 'answered' else 'saved' end;
end
$fn$;

comment on function app.guest_survey(text, text) is
  'Whether the guest''s page offers the survey (D27-383): on here, checked out, not answered.';
comment on function app.guest_survey_answer(text, text, int, int, int, int, int, text) is
  'The guest''s one answer for the stay. Behind this phone''s unlock; never a second.';

revoke all on function app.guest_survey(text, text) from public;
revoke all on function app.guest_survey_answer(text, text, int, int, int, int, int, text) from public;
grant execute on function app.guest_survey(text, text) to pms_app;
grant execute on function app.guest_survey_answer(text, text, int, int, int, int, int, text) to pms_app;
