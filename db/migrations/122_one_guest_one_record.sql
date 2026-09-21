-- =============================================================================
-- 122 · One guest, one record — the Central CRM, phase 1 (docs/briefs/crm.md)
-- =============================================================================
-- Written as 121, the next free number after 120; the master gave it 122 on
-- 21 September, when online check-in's 121 merged first (MEMORY 301, 302).
-- Refer to this file by what it does - "one guest, one record" - never by
-- its number.
--
-- THE FACT IT STANDS ON (root MEMORY 311). `guests` has no hotel_id and was
-- meant to hold a person once for the whole group (004). It does not: every
-- booking and every walk-in inserts a fresh row with no lookup, so the same
-- person twice is two rows, and `is_blacklisted` is a column nothing set and
-- nothing read. This file gives the desk and the managers what they need to
-- make "one person" true, with every choice the owner's (21 September, D21-2,
-- D21-13, D21-20 to D21-22, D21-72, and the CRM chat's questions recorded in
-- src/modules/crm/MODULE.md):
--
--   1  a phone and an email reduced to the key two of them are compared on
--   2  a joined-away record points at the one that stands for the person
--   3  owner, admin and GM - the three who may join, blacklist and see it all
--   4  "stayed with the group N times": checked-in visits, a group once
--   5  the suggestion at a booking or a walk-in, and its refusal to guess
--   6  joins, recorded and undoable; nothing is ever deleted
--   7  "do not send me offers", against the phone or email itself
--   8  the "possible same person" list and Guest 360, managers only
--   9  the "guest agreed to WhatsApp" tick on a booking
--
-- A WRONG JOIN IS WORSE THAN A MISSED ONE (the brief). Two people made one
-- shows one guest another's stays and bills. So nothing here joins by
-- itself: the database suggests, a person confirms, and every join can be
-- taken apart again exactly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The keys a phone and an email are compared on
-- -----------------------------------------------------------------------------
-- The owner, 21 September: '+91 98765 43210', '098765 43210' and '9876543210'
-- are one number; anything else must match digit for digit; a number under ten
-- digits, or all one digit (0000000000), never suggests anybody - a clerk's
-- placeholder would otherwise "match" every guest typed with it.
--
-- ⚠ src/modules/guests/logic/contactKeys.ts is the same rule in TypeScript,
-- for marketing's gate. Each has a test over the SAME sample numbers
-- (db/tests/modules/crm.sql, contactKeys.test.ts): change one, change both.
create or replace function app.phone_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when k is null or length(k) < 10 or k ~ '^(\d)\1*$' then null
              else k end
    from (select case when length(d) = 12 and left(d, 2) = '91' then right(d, 10)
                      when length(d) = 11 and left(d, 1) = '0'  then right(d, 10)
                      else d end as k
            from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x
         ) y
$$;

comment on function app.phone_key(text) is
  'The digits two phone numbers are compared on (the owner, 21 September): an '
  'Indian number with +91 or a leading 0 is its last ten digits; any other is '
  'its digits; under ten digits, or all one digit, is NULL and matches nothing.';

create or replace function app.email_key(p text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(lower(btrim(coalesce(p, ''))), '')
$$;

comment on function app.email_key(text) is
  'An email address as two of them are compared: trimmed, lower case, NULL when blank.';

create index if not exists guests_phone_key_idx on guests (app.phone_key(phone));
create index if not exists guests_email_key_idx on guests (app.email_key(email::text));


-- -----------------------------------------------------------------------------
-- 2 · A joined-away record, and the one that stands for the person
-- -----------------------------------------------------------------------------
-- A join never deletes (015: a guest is never deleted). The record joined away
-- keeps everything it had and points at the one that now stands for the
-- person, so an undo can put it back exactly, and a booking typed with its old
-- phone number still finds the person it belongs to.
alter table guests add column if not exists joined_into uuid references guests(id);

comment on column guests.joined_into is
  'Set when a manager joined this record into another (guest_joins). NULL for '
  'every record that stands for a person. Never set by anything but '
  'app.guest_join, and cleared only by app.guest_join_undo.';

-- Guarded: added once, never rewritten on a replay (MEMORY 284, 293).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'guests_not_joined_into_self') then
    alter table guests add constraint guests_not_joined_into_self
      check (joined_into is distinct from id);
  end if;
end
$$;

create index if not exists guests_joined_into_idx on guests (joined_into)
  where joined_into is not null;

-- Follows the chain up to the record that stands. A chain is short - it grows
-- only when a record that others were joined into is itself joined - and the
-- depth cap is a guard against a cycle nothing should be able to make.
create or replace function app.guest_standing(p_guest uuid)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  with recursive up(id, next, depth) as (
    select g.id, g.joined_into, 0 from guests g where g.id = p_guest
    union all
    select g.id, g.joined_into, u.depth + 1
      from up u join guests g on g.id = u.next
     where u.depth < 50
  )
  select id from up where next is null limit 1
$$;


-- -----------------------------------------------------------------------------
-- 3 · Who may join, blacklist and see a guest whole: owner, admin and GM
-- -----------------------------------------------------------------------------
-- D21-4 and D21-21 name the three. `app.is_manager()` (013) answers for the
-- owner, the GM and a group administrator, and NOT for the admin role - so
-- the blacklist trigger 013 wrote refused an administrator the owner had just
-- said may blacklist. `is_manager` is left alone: booking sources' insert
-- policy reads it, and widening that is not this file's business.
create or replace function app.is_crm_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_manager() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and sh.role = 'admin'
  )
$$;

comment on function app.is_crm_manager() is
  'The owner, an administrator or a general manager (D21-4, D21-21): who may '
  'blacklist, join two guests, and see a guest''s whole history.';

create or replace function app.guard_blacklist()
returns trigger
language plpgsql
as $$
begin
  if (new.is_blacklisted is distinct from old.is_blacklisted
      or new.blacklist_reason is distinct from old.blacklist_reason)
     and not app.is_crm_manager() then
    raise exception 'Only the owner, an administrator or a general manager may change a guest blacklist.'
      using hint = 'Ask one of them.';
  end if;
  return new;
end
$$;


-- -----------------------------------------------------------------------------
-- 4 · "Stayed with the group N times"
-- -----------------------------------------------------------------------------
-- The owner, 21 September: every booking that was checked in - in house now,
-- or already left - at any hotel of the group. Several rooms booked together
-- count once. Cancelled, no-show, voided and future bookings do not count.
--
-- SECURITY DEFINER because a desk sees only its own hotel's bookings, and the
-- count is of the whole group's. It answers a NUMBER and nothing else - no
-- hotels, no dates, no amounts (D21-13).
--
-- p_except leaves out the visit a booking belongs to, so the mark on a stay
-- says how often they came BEFORE, not counting the stay being looked at.
create or replace function app.guest_visits(p_guest uuid, p_except uuid default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct coalesce(r.group_id, r.id))::int
    from reservations r
   where r.guest_id = p_guest
     and r.status in ('checked_in', 'checked_out')
     and coalesce(r.group_id, r.id) is distinct from
         (select coalesce(x.group_id, x.id) from reservations x where x.id = p_except)
$$;

comment on function app.guest_visits(uuid, uuid) is
  'Checked-in visits at any hotel of the group, several rooms booked together '
  'counted once (the owner, 21 September). A count only (D21-13).';


-- -----------------------------------------------------------------------------
-- 5 · The suggestion at a booking or a walk-in (D21-20)
-- -----------------------------------------------------------------------------
-- Every PERSON the typed phone or email is on - a joined-away record leads to
-- the one that stands - with:
--
--   suggested   false when anything typed DISAGREES with what is on file for
--               that person: a phone typed, the person has phones, and none of
--               them is this one; the same for email. Details that disagree
--               are doubt, and in doubt the code suggests nothing (the owner,
--               21 September). The person then shows on the "possible same
--               person" list instead, for a manager.
--   blacklist   on EVERY match, suggested or not: D21-21 warns the clerk
--               whenever the phone or email is a blacklisted guest's.
--
-- Two people who share a surname are never suggested: nothing here reads a name.
create or replace function app.guest_suggestions(p_phone text, p_email text)
returns table (
  guest_id uuid, full_name text, visits integer,
  is_blacklisted boolean, blacklist_reason text, suggested boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive
  typed as (
    select app.phone_key(p_phone) as phone, app.email_key(p_email) as email
  ),
  hit as (
    select distinct app.guest_standing(g.id) as person
      from guests g, typed t
     where (t.phone is not null and app.phone_key(g.phone) = t.phone)
        or (t.email is not null and app.email_key(g.email::text) = t.email)
  ),
  family(person, id) as (
    select person, person from hit
    union
    select f.person, g.id from family f join guests g on g.joined_into = f.id
  ),
  known as (
    select f.person,
           bool_or(app.phone_key(g.phone) is not null)                         as has_phone,
           bool_or(app.phone_key(g.phone) = t.phone)                           as phone_on_file,
           bool_or(app.email_key(g.email::text) is not null)                   as has_email,
           bool_or(app.email_key(g.email::text) = t.email)                     as email_on_file
      from family f
      join guests g on g.id = f.id
     cross join typed t
     group by f.person
  )
  select p.id, p.full_name, app.guest_visits(p.id), p.is_blacklisted, p.blacklist_reason,
         not (   (t.phone is not null and k.has_phone and not coalesce(k.phone_on_file, false))
              or (t.email is not null and k.has_email and not coalesce(k.email_on_file, false)))
    from known k
    join guests p on p.id = k.person
   cross join typed t
$$;

comment on function app.guest_suggestions(text, text) is
  'Who a typed phone or email already belongs to (D21-20): suggested only when '
  'nothing typed disagrees with what is on file; the blacklist on every match '
  '(D21-21). Reads no name.';

-- The clerk said "yes, same person". Checked again HERE, not trusted from the
-- browser: a guest id is only used if the phone or email typed still suggests
-- exactly that person. Then a blank phone or email on the record is filled in
-- from what was typed; nothing on file is overwritten (the owner, 21 Sept).
-- Answers NULL, having written nothing, when the id does not qualify.
create or replace function app.use_returning_guest(p_guest uuid, p_phone text, p_email text)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if not exists (select 1 from app.guest_suggestions(v_phone, v_email) s
                  where s.guest_id = p_guest and s.suggested) then
    return null;
  end if;

  update guests
     set phone = coalesce(phone, v_phone),
         email = coalesce(email, v_email::citext)
   where id = p_guest
     and ((phone is null and v_phone is not null)
       or (email is null and v_email is not null));

  return p_guest;
end
$$;


-- -----------------------------------------------------------------------------
-- 6 · Joins — recorded, undoable, and nothing deleted (D21-2)
-- -----------------------------------------------------------------------------
-- A join moves the joined record's STAYS to the one that stands, and marks
-- the joined record as joined. That is all it changes, and all of it is
-- written down here so an undo can take it apart exactly:
--
--   reservation_ids  the stays that moved, and only those go back. A booking
--                    made on the person after the join stays with them.
--   kept_before      the standing record's VIP and blacklist before the join,
--   kept_after       and after it. The owner, 21 September: a blacklist or VIP
--                    on EITHER record stays on the joined guest, and comes off
--                    again on undo - unless somebody changed it since, in
--                    which case their decision stands.
--
-- IDENTITY DOCUMENTS DO NOT MOVE (the brief, rule 1). `guest_documents` is
-- keyed by guest, so: when only one record has an ID on file, that record must
-- be the one that stands - no ID is lost; when both do, the manager chooses,
-- and the other ID stays untouched on its own record for an undo.
create table if not exists guest_joins (
  id              uuid primary key default gen_random_uuid(),
  kept_id         uuid not null references guests(id),
  joined_id       uuid not null references guests(id),
  reservation_ids uuid[] not null,
  kept_before     jsonb not null,
  kept_after      jsonb not null,
  joined_by       uuid not null references staff(id),
  joined_at       timestamptz not null default now(),
  undone_by       uuid references staff(id),
  undone_at       timestamptz,

  constraint guest_joins_two_records check (kept_id <> joined_id),
  constraint guest_joins_undone_whole check ((undone_by is null) = (undone_at is null))
);

comment on table guest_joins is
  'Every join of two guest records, who made it and when, exactly what moved, '
  'and whether it was undone (D21-2). Written only by app.guest_join and '
  'app.guest_join_undo.';

create unique index if not exists guest_joins_one_live
  on guest_joins (joined_id) where undone_at is null;
create index if not exists guest_joins_by_kept on guest_joins (kept_id);

alter table guest_joins enable row level security;
alter table guest_joins force  row level security;

drop policy if exists guest_joins_managers on guest_joins;
create policy guest_joins_managers on guest_joins
  for select using ( app.is_crm_manager() );

-- Read by the managers' screen; written only through the two functions below.
grant select on guest_joins to pms_app;

create or replace function app.guest_join(p_kept uuid, p_joined uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_kept   guests;
  v_joined guests;
  v_ids    uuid[];
  v_before jsonb;
  v_after  jsonb;
  v_join   uuid;
begin
  if not app.is_crm_manager() then
    raise exception 'Joining two guests is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;
  if p_kept is null or p_joined is null or p_kept = p_joined then
    raise exception 'Choose two different guests to join.';
  end if;

  -- Both rows locked, in a fixed order, so two managers joining the same pair
  -- at once cannot each move half of it.
  perform 1 from guests where id in (p_kept, p_joined) order by id for update;
  select * into v_kept   from guests where id = p_kept;
  select * into v_joined from guests where id = p_joined;
  if v_kept.id is null or v_joined.id is null then
    raise exception 'One of those guests does not exist.';
  end if;
  if v_kept.joined_into is not null or v_joined.joined_into is not null then
    raise exception 'One of those records was already joined to another guest. Start from the one that stands.';
  end if;

  if exists (select 1 from guest_documents where guest_id = p_joined)
     and not exists (select 1 from guest_documents where guest_id = p_kept) then
    raise exception 'Only % has an ID on file. Keep that record, so the ID stays with the guest.',
      v_joined.full_name;
  end if;

  select coalesce(array_agg(id order by id), '{}') into v_ids
    from reservations where guest_id = p_joined;

  update reservations set guest_id = p_kept where guest_id = p_joined;

  v_before := jsonb_build_object(
    'is_vip', v_kept.is_vip,
    'is_blacklisted', v_kept.is_blacklisted,
    'blacklist_reason', v_kept.blacklist_reason);
  v_after := jsonb_build_object(
    'is_vip', v_kept.is_vip or v_joined.is_vip,
    'is_blacklisted', v_kept.is_blacklisted or v_joined.is_blacklisted,
    'blacklist_reason', case when v_kept.is_blacklisted   then v_kept.blacklist_reason
                             when v_joined.is_blacklisted then v_joined.blacklist_reason
                             else v_kept.blacklist_reason end);

  if v_after is distinct from v_before then
    update guests
       set is_vip           = (v_after ->> 'is_vip')::boolean,
           is_blacklisted   = (v_after ->> 'is_blacklisted')::boolean,
           blacklist_reason = v_after ->> 'blacklist_reason'
     where id = p_kept;
  end if;

  update guests set joined_into = p_kept where id = p_joined;

  insert into guest_joins (kept_id, joined_id, reservation_ids, kept_before, kept_after, joined_by)
  values (p_kept, p_joined, v_ids, v_before, v_after, app.current_user_id())
  returning id into v_join;

  return v_join;
end
$$;

comment on function app.guest_join(uuid, uuid) is
  'Joins p_joined into p_kept: moves its stays, carries a blacklist or VIP over, '
  'marks it joined, and records all of it for an undo. Owner, admin, GM only.';

create or replace function app.guest_join_undo(p_join uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_join guest_joins;
  v_kept guests;
begin
  if not app.is_crm_manager() then
    raise exception 'Undoing a join is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;

  select * into v_join from guest_joins where id = p_join for update;
  if v_join.id is null then
    raise exception 'There is no such join.';
  end if;
  if v_join.undone_at is not null then
    raise exception 'That join was already undone.';
  end if;

  select * into v_kept from guests where id = v_join.kept_id for update;
  if v_kept.joined_into is not null then
    raise exception '% was joined into another guest after this. Undo that join first.',
      v_kept.full_name;
  end if;

  update reservations set guest_id = v_join.joined_id
   where id = any (v_join.reservation_ids) and guest_id = v_join.kept_id;

  update guests set joined_into = null where id = v_join.joined_id;

  -- Put the marks back only where they are still what the join left them.
  update guests
     set is_vip = (v_join.kept_before ->> 'is_vip')::boolean
   where id = v_join.kept_id
     and is_vip = (v_join.kept_after ->> 'is_vip')::boolean
     and is_vip is distinct from (v_join.kept_before ->> 'is_vip')::boolean;
  update guests
     set is_blacklisted   = (v_join.kept_before ->> 'is_blacklisted')::boolean,
         blacklist_reason = v_join.kept_before ->> 'blacklist_reason'
   where id = v_join.kept_id
     and is_blacklisted = (v_join.kept_after ->> 'is_blacklisted')::boolean
     and blacklist_reason is not distinct from v_join.kept_after ->> 'blacklist_reason'
     and (is_blacklisted, blacklist_reason) is distinct from
         ((v_join.kept_before ->> 'is_blacklisted')::boolean, v_join.kept_before ->> 'blacklist_reason');

  update guest_joins
     set undone_by = app.current_user_id(), undone_at = now()
   where id = p_join;
end
$$;

comment on function app.guest_join_undo(uuid) is
  'Takes a join apart: exactly the stays it moved go back, the joined record '
  'stands again, and the marks it carried over come off if nobody changed them '
  'since. A later join on the same person is undone first.';


-- -----------------------------------------------------------------------------
-- 7 · "Do not send me offers" (D21-22)
-- -----------------------------------------------------------------------------
-- Against the PHONE NUMBER OR EMAIL ITSELF, for the whole group - never on a
-- guest row, which the next booking would duplicate. Stored as the key, so
-- '+91 98765 43210' asked at one hotel covers '9876543210' typed at another.
--
-- The owner, 21 September: the desk records it (a tick on the booking form and
-- the walk-in); the owner, an administrator or a GM may also record it, or
-- clear it, on Guest 360. Who and when: recorded_by and recorded_at on the row,
-- and a clearing is in the audit log with the row it removed.
--
-- Marketing's gate (`mayBeWrittenTo`, src/modules/marketing/logic/lists.ts) is
-- the reader; making it read this is the master's (src/modules/crm/MODULE.md).
create table if not exists offer_opt_outs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  value       text not null,
  recorded_by uuid references staff(id),
  recorded_at timestamptz not null default now(),

  constraint offer_opt_outs_kind check (kind in ('phone', 'email')),
  constraint offer_opt_outs_is_a_key check (
    (kind = 'phone' and value = app.phone_key(value))
    or (kind = 'email' and value = app.email_key(value))),
  constraint offer_opt_outs_once unique (kind, value)
);

comment on table offer_opt_outs is
  'A phone number or email address that asked not to be sent offers, for the '
  'whole group (D21-22). Kept as its matching key.';

alter table offer_opt_outs enable row level security;
alter table offer_opt_outs force  row level security;

drop policy if exists offer_opt_outs_read on offer_opt_outs;
create policy offer_opt_outs_read on offer_opt_outs
  for select using ( app.is_active_staff() );

drop policy if exists offer_opt_outs_record on offer_opt_outs;
create policy offer_opt_outs_record on offer_opt_outs
  for insert with check ( app.is_active_staff() );

drop policy if exists offer_opt_outs_clear on offer_opt_outs;
create policy offer_opt_outs_clear on offer_opt_outs
  for delete using ( app.is_crm_manager() );

grant select, insert, delete on offer_opt_outs to pms_app;

drop trigger if exists offer_opt_outs_audit on offer_opt_outs;
create trigger offer_opt_outs_audit after insert or update or delete on offer_opt_outs
  for each row execute function app.write_audit();

-- The one way it is recorded, from the booking form, the walk-in and Guest
-- 360 alike. A number that is not one (under ten digits) records nothing:
-- there is nothing it could ever be matched against. Answers how many of the
-- two were newly recorded.
create or replace function app.record_no_offers(p_phone text, p_email text)
returns integer
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  v_rows int;
begin
  if app.phone_key(p_phone) is not null then
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('phone', app.phone_key(p_phone), app.current_user_id())
    on conflict (kind, value) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  if app.email_key(p_email) is not null then
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('email', app.email_key(p_email), app.current_user_id())
    on conflict (kind, value) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  return v_n;
end
$$;


-- -----------------------------------------------------------------------------
-- 8 · What the managers read: the "possible same person" list and Guest 360
-- -----------------------------------------------------------------------------
-- Every one answers nothing to anybody but the owner, an administrator or a
-- GM (D21-4), whatever route calls it - the route refuses first, and this is
-- the second lock, not the only one.

-- Two records that stand for people and share a phone or an email. Built as
-- two equality joins on the keys, never a join on "a = b or c = d", which
-- would compare every guest with every other one.
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
  )
  select pr.a, pr.b,
         coalesce(x.p = y.p, false), coalesce(x.e = y.e, false)
    from pairs pr
    join keyed x on x.id = pr.a
    join keyed y on y.id = pr.b
   where app.is_crm_manager()
$$;

-- What a manager needs to judge whether two records are one person, and no
-- more: never the document itself, only whether one is on file (the brief).
create or replace function app.guest_cards(p_ids uuid[])
returns table (
  id uuid, full_name text, phone text, email text, visits integer,
  has_id boolean, is_vip boolean, is_blacklisted boolean, blacklist_reason text,
  last_stay text, joined_into uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id, g.full_name, g.phone, g.email::text, app.guest_visits(g.id),
         exists (select 1 from guest_documents d where d.guest_id = g.id),
         g.is_vip, g.is_blacklisted, g.blacklist_reason,
         (select max(r.check_out)::text from reservations r
           where r.guest_id = g.id and r.status in ('checked_in', 'checked_out')),
         g.joined_into
    from guests g
   where g.id = any (p_ids)
     and app.is_crm_manager()
$$;

-- Guest 360's search: by name, or by a phone or email as the desk would type it.
create or replace function app.guest_search(p_q text)
returns table (id uuid, full_name text, phone text, email text, visits integer,
               is_blacklisted boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id, g.full_name, g.phone, g.email::text, app.guest_visits(g.id), g.is_blacklisted
    from guests g
   where g.joined_into is null
     and app.is_crm_manager()
     and length(btrim(coalesce(p_q, ''))) >= 2
     and (   g.full_name ilike '%' || btrim(p_q) || '%'
          or app.phone_key(g.phone) = app.phone_key(p_q)
          or app.email_key(g.email::text) = app.email_key(p_q))
   order by g.full_name, g.id
   limit 50
$$;

-- ONE DEFINITION OF WHAT A STAY WAS CHARGED (the owner, 21 September: "the
-- same as the Guests screen"). Everything charged to the stay's bills, with
-- tax; a reversed posting and its reversal left out; payments not counted.
-- The Guests screen and Guest 360 both read it here, so they cannot disagree.
-- Invoker: on the Guests screen the hotel's own row security still decides
-- what is summed.
create or replace function app.stay_charged(p_reservation uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(fp.amount + fp.tax_amount), 0)
    from folio_postings fp
    join folios f on f.id = fp.folio_id
   where f.reservation_id = p_reservation
     and fp.category <> 'payment'
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
$$;

-- Guest 360 (D21-3, D21-4): one person, every stay at every hotel, what they
-- were charged, what was sent to them, the blacklist and the opt-out. READ
-- ONLY - editing a guest stays on the Guests screen. Never the ID document:
-- only whether one is on file. The leads app's conversations are a link, not a
-- copy (D21-5), so none of them is here. NULL for anybody but the three.
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
  sent as (
    select m.sent_at, m.channel, m.kind, m.status, h.name as hotel_name
      from messages_sent m
      join hotels h on h.id = m.hotel_id
     where (m.about_kind = 'reservation' and m.about_id in (select id::text from stays))
        or app.phone_key(m.to_phone) in (select k from phones)
        or app.email_key(m.to_email) in (select k from emails)
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
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'hotelCode', s.hotel_code, 'hotelName', s.hotel_name,
               'reference', s.reference, 'checkIn', s.check_in::text,
               'checkOut', s.check_out::text, 'status', s.status,
               'roomType', s.room_type, 'source', s.source, 'charged', s.charged)
             order by s.check_in desc, s.reference)
        from stays s), '[]'),
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
       where (o.kind = 'phone' and o.value in (select k from phones))
          or (o.kind = 'email' and o.value in (select k from emails))), '[]'),
    'joined', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'guestId', j.joined_id,
                                          'name', g.full_name, 'at', j.joined_at)
             order by j.joined_at desc)
        from guest_joins j join guests g on g.id = j.joined_id
       where j.kept_id = p.id and j.undone_at is null), '[]')
  )
  from person p
$$;


-- -----------------------------------------------------------------------------
-- 9 · "Guest agreed to WhatsApp" (D21-72)
-- -----------------------------------------------------------------------------
-- WhatsApp's own rule: a business may start a conversation only with somebody
-- who agreed. The desk asks on phone and walk-in bookings; a booking from a
-- channel arrives unticked, which is what false is - "not agreed", never a
-- guess that they did. Guest messages reads it later (unticked: email if
-- there is one, else nothing). The reservations audit trigger (011) records
-- who ticked or unticked it, and when.
alter table reservations add column if not exists whatsapp_agreed boolean not null default false;

comment on column reservations.whatsapp_agreed is
  'The guest agreed to be written to on WhatsApp (D21-72). Ticked by the desk '
  'at booking, at a walk-in or later on the stay; false for a channel booking.';


-- -----------------------------------------------------------------------------
-- Who may call what
-- -----------------------------------------------------------------------------
-- The SECURITY DEFINER functions only - each reads past row security. The
-- helpers stay callable by anybody: the two keys run inside an index and a
-- check that every role inserting a guest evaluates, and the invoker
-- functions are held by the policies of the tables they touch.
do $$
declare f text;
begin
  foreach f in array array[
    'app.guest_visits(uuid, uuid)', 'app.guest_suggestions(text, text)',
    'app.guest_join(uuid, uuid)', 'app.guest_join_undo(uuid)',
    'app.same_person_pairs()', 'app.guest_cards(uuid[])', 'app.guest_search(text)',
    'app.guest_360(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to pms_app', f);
  end loop;
end
$$;
