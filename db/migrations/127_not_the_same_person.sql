-- =============================================================================
-- 127 · "Not the same person", and a booking site's blacklisted guest
--       (CRM-2 and CRM-3, the owner's D22-8, 22 September)
-- =============================================================================
-- Written as 128 on the master's word; the master renumbers at merge. Refer to
-- this file by what it does - "not the same person" - never by its number.
--
-- Builds on "one guest, one record" (the CRM's phase 1). Two things:
--
--   1  NOT THE SAME PERSON (CRM-2). A family on one mobile, or a travel
--      agent's number typed as the guest's, is two people who share a phone.
--      They sat on the "possible same person" list for ever, because the only
--      answer a manager could give was a join - the wrong join the brief warns
--      about. Now the owner, an administrator or a GM may answer "not the same
--      person": the pair leaves the list and is not listed again, who said so
--      and when is kept, and it can be undone, as a join can.
--
--   2  A BOOKING SITE'S GUEST WHO MATCHES A BLACKLISTED GUEST (CRM-3). A
--      booking the channel manager makes has no clerk to see the warning a
--      typed phone gives (D21-21). The owner chose a warning on Arrivals and
--      at check-in instead. The match is the desk's own - an exact phone or
--      email, app.guest_suggestions - so there is one rule, not two. It is a
--      WARNING: nothing is joined, nothing is refused (D21-2, D21-21).
--
-- Nothing here changes a guest, a booking or a join already made. Replayed on
-- every deploy, so every statement is `if not exists`, guarded, or a
-- `create or replace` that keeps the signature it had (MEMORY 317).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · "Not the same person" (CRM-2)
-- -----------------------------------------------------------------------------
-- One row per answer. `a` is the lower id of the two, so a pair has one
-- spelling and one live answer. An undo keeps the row and says who undid it
-- and when - the shape guest_joins has.
create table if not exists guest_not_same (
  id        uuid primary key default gen_random_uuid(),
  a         uuid not null references guests(id),
  b         uuid not null references guests(id),
  said_by   uuid not null references staff(id),
  said_at   timestamptz not null default now(),
  undone_by uuid references staff(id),
  undone_at timestamptz,

  constraint guest_not_same_one_spelling check (a < b),
  constraint guest_not_same_undone_whole check ((undone_by is null) = (undone_at is null))
);

comment on table guest_not_same is
  'A manager''s answer that two guest records sharing a phone or email are two '
  'people (CRM-2, D22-8): the pair is not listed as "possible same person" '
  'again while it stands. Written only by app.guest_not_same and its undo.';

create unique index if not exists guest_not_same_one_live
  on guest_not_same (a, b) where undone_at is null;

alter table guest_not_same enable row level security;
alter table guest_not_same force  row level security;

drop policy if exists guest_not_same_managers on guest_not_same;
create policy guest_not_same_managers on guest_not_same
  for select using ( app.is_crm_manager() );

-- Read by the managers' screen; written only through the two functions below.
grant select on guest_not_same to pms_app;

-- Answers the id of the answer that stands: a second press on the same pair
-- is the same answer, not a second one.
create or replace function app.guest_not_same(p_a uuid, p_b uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_standing int;
begin
  if not app.is_crm_manager() then
    raise exception 'Saying two guests are not the same person is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Choose two different guests.';
  end if;

  select count(*) into v_standing
    from guests where id in (p_a, p_b) and joined_into is null;
  if v_standing < 2 then
    raise exception 'One of those records is not a guest that stands. Start from the list as it is now.';
  end if;

  insert into guest_not_same (a, b, said_by)
  values (least(p_a, p_b), greatest(p_a, p_b), app.current_user_id())
  on conflict (a, b) where undone_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from guest_not_same
     where a = least(p_a, p_b) and b = greatest(p_a, p_b) and undone_at is null;
  end if;
  return v_id;
end
$$;

comment on function app.guest_not_same(uuid, uuid) is
  'Records that two standing guest records are two people (CRM-2): they leave '
  'the "possible same person" list. Owner, admin, GM only; undone by '
  'app.guest_not_same_undo.';

create or replace function app.guest_not_same_undo(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row guest_not_same;
begin
  if not app.is_crm_manager() then
    raise exception 'Undoing that is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;

  select * into v_row from guest_not_same where id = p_id for update;
  if v_row.id is null then
    raise exception 'There is no such answer.';
  end if;
  if v_row.undone_at is not null then
    raise exception 'That was already undone.';
  end if;

  update guest_not_same
     set undone_by = app.current_user_id(), undone_at = now()
   where id = p_id;
end
$$;

comment on function app.guest_not_same_undo(uuid) is
  'Takes back a "not the same person" answer: the pair is listed again.';

-- The list, as phase 1 built it, less every pair a manager answered. An answer
-- follows each record to the one that stands for it now, so a record answered
-- "not him" and later joined into a third is not offered as him again through
-- the third. Same signature and return type as before (MEMORY 317).
create or replace function app.same_person_pairs()
returns table (a uuid, b uuid, same_phone boolean, same_email boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with keyed as (
    select id, app.phone_key(phone) as p, app.email_key(email::text) as e
      from guests
     where joined_into is null
  ),
  pairs as (
    select x.id as a, y.id as b from keyed x join keyed y on y.p = x.p and x.id < y.id
    union
    select x.id, y.id from keyed x join keyed y on y.e = x.e and x.id < y.id
  ),
  answered as (
    select least(s.a, s.b) as a, greatest(s.a, s.b) as b
      from (select app.guest_standing(n.a) as a, app.guest_standing(n.b) as b
              from guest_not_same n
             where n.undone_at is null) s
  )
  select pr.a, pr.b,
         coalesce(x.p = y.p, false), coalesce(x.e = y.e, false)
    from pairs pr
    join keyed x on x.id = pr.a
    join keyed y on y.id = pr.b
   where app.is_crm_manager()
     and not exists (select 1 from answered d where d.a = pr.a and d.b = pr.b)
$$;


-- -----------------------------------------------------------------------------
-- 2 · A booking site's guest who matches a blacklisted guest (CRM-3)
-- -----------------------------------------------------------------------------
-- Every booking at this hotel arriving between the two dates, taken through a
-- booking site (a source of kind 'ota' - the channel manager's door and a
-- booking site's reservation typed in alike), whose guest's phone or email is
-- a blacklisted person's, by the desk's own rule (app.guest_suggestions: an
-- exact key, a joined-away record leading to the one that stands). One row per
-- booking and blacklisted person, with the reason the desk is shown.
--
-- INVOKER, on purpose: row security on reservations decides which bookings a
-- person may ask about - their own hotel's - exactly as the Arrivals list
-- does. The suggestion under it is the only part that reads the whole group.
create or replace function app.booking_site_blacklist(p_hotel uuid, p_from date, p_to date)
returns table (
  reservation_id uuid, reference text, guest_name text, source text,
  blacklisted_name text, blacklist_reason text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select r.id, r.reference, g.full_name, bs.name, s.full_name, s.blacklist_reason
    from reservations r
    join booking_sources bs on bs.id = r.booking_source_id and bs.kind = 'ota'
    join guests g on g.id = r.guest_id
   cross join lateral app.guest_suggestions(g.phone, g.email::text) s
   where r.hotel_id = p_hotel
     and r.check_in between p_from and p_to
     and s.is_blacklisted
   order by r.check_in, r.reference, s.full_name
$$;

comment on function app.booking_site_blacklist(uuid, date, date) is
  'Bookings from a booking site arriving in the range whose guest''s phone or '
  'email is a blacklisted guest''s (CRM-3, D22-8). A warning for Arrivals and '
  'check-in; never a join and never a refusal (D21-2, D21-21).';


-- -----------------------------------------------------------------------------
-- Who may call what
-- -----------------------------------------------------------------------------
-- The two SECURITY DEFINER writers are the application's alone, as the joins
-- are. app.same_person_pairs keeps the grant "one guest, one record" gave it;
-- the invoker function is held by the policies of the tables it reads.
do $$
declare f text;
begin
  foreach f in array array['app.guest_not_same(uuid, uuid)', 'app.guest_not_same_undo(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to pms_app', f);
  end loop;
end
$$;
