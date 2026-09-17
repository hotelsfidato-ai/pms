-- =============================================================================
-- 087 · Each person's first screen, and reception on the POS per hotel
-- =============================================================================
-- Phase 1 of the plan the owner approved on 14 September. Two decisions, both
-- his:
--
--   "have the option to set default for any person in the settings"
--       → the GM sets each person's FIRST SCREEN AFTER SIGN-IN (Dashboard,
--         Rooms or Calendar), and the person can change their own.
--         The Room type / Floor grouping stays, remembered per person.
--
--   "the receptionist will now have access to this POS system"
--       → a per-hotel switch, "Reception can use the POS", set by the GM.
--         On at every hotel that exists when this arrives, off for any hotel
--         added after.
--
-- ⚠ BOTH PREFERENCES LIVE ON THE SERVER, NOT IN THE BROWSER. The Calendar /
-- Rooms choice was kept in localStorage — per device. A receptionist who uses
-- the desk terminal and a phone had two different answers, and a GM setting
-- somebody's default could not have reached either.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The preferences
-- -----------------------------------------------------------------------------
alter table staff add column if not exists home_screen text;
alter table staff drop constraint if exists staff_home_screen_known;
alter table staff add constraint staff_home_screen_known
  check (home_screen is null or home_screen in ('dashboard', 'rooms', 'calendar'));

alter table staff add column if not exists room_grouping text not null default 'type';
alter table staff drop constraint if exists staff_room_grouping_known;
alter table staff add constraint staff_room_grouping_known
  check (room_grouping in ('type', 'floor'));

comment on column staff.home_screen is
  'The first screen after sign-in: dashboard, rooms or calendar. NULL is the '
  'Dashboard — what everybody got before this column existed. Set by the GM '
  'for their staff and by each person for themselves (087).';
comment on column staff.room_grouping is
  'How Rooms and Calendar group the house for this person: by room type or by '
  'floor. Per person, so it follows them between the desk and a phone.';

-- What the signed-in person's own preferences are. SECURITY DEFINER for the
-- reason 027 records: a read of `staff` from inside a policy on `staff`
-- recurses, and this is asked on every session.
create or replace function app.my_preferences()
returns table (home_screen text, room_grouping text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(s.home_screen, 'dashboard'), s.room_grouping
    from staff s
   where s.id = app.current_user_id();
$$;

-- A person changing their own. Only these two columns, whatever else the
-- caller would like to change — that is why it is a function and not an
-- UPDATE the API composes. A NULL argument leaves that preference alone.
create or replace function app.set_my_preferences(p_home_screen text, p_room_grouping text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.current_user_id() is null then
    raise exception 'Nobody is signed in.' using errcode = '42501';
  end if;
  update staff
     set home_screen   = coalesce(p_home_screen, home_screen),
         room_grouping = coalesce(p_room_grouping, room_grouping)
   where id = app.current_user_id();
end $$;

-- The GM setting it for somebody else. Whoever may manage the person (084:
-- themselves, a group administrator, or a GM of a hotel they are rostered
-- at — and never a group administrator by a GM) may set their first screen.
create or replace function app.set_home_screen(p_staff uuid, p_home_screen text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not app.may_manage_person(p_staff) then
    raise exception 'That person is not yours to change.' using errcode = '42501';
  end if;
  update staff set home_screen = p_home_screen where id = p_staff;
  if not found then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;
end $$;

grant execute on function app.my_preferences() to pms_app;
grant execute on function app.set_my_preferences(text, text) to pms_app;
grant execute on function app.set_home_screen(uuid, text) to pms_app;


-- -----------------------------------------------------------------------------
-- Reception on the POS, per hotel
-- -----------------------------------------------------------------------------
-- A module like `pos` and `banquet` (041): one row per hotel, the same switch
-- screen, the same who-and-when. `app.module_enabled` reads an ABSENT row as
-- off for anything but `pos`, so a hotel added after this is off until its GM
-- turns it on — the owner's call.
-- ⚠ ONLY IF IT IS NOT ALREADY THERE. Every migration replays on every deploy,
-- and a LATER migration widens this same constraint (108 adds
-- 'channel_manager'). Rewritten blindly, this line puts the narrow list back on
-- the next deploy and Postgres validates it against the rows that exist: one
-- hotel switched on for the channel manager and the whole run rolls back, so
-- the API is never upgraded. Found by the channel-manager chat on 17 September
-- by switching a hotel on and running db/migrate.sh; the same shape as MEMORY
-- 284, which 095 and 096 were fixed into.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'hotel_modules'::regclass
       and conname  = 'hotel_modules_known'
       and pg_get_constraintdef(oid) like '%reception_pos%'
  ) then
    alter table hotel_modules drop constraint if exists hotel_modules_known;
    alter table hotel_modules add constraint hotel_modules_known
      check (module in ('pos', 'banquet', 'reception_pos'));
  end if;
end $$;

-- ⚠ ONCE, AND ONLY ONCE. Every hotel that exists when this arrives keeps what
-- its reception has today — the till never checked their role, so they could
-- use it. Guarded on "no reception_pos row anywhere", because migrations
-- replay on every deploy: an unguarded insert would switch it ON for every
-- hotel created since, on the next deploy, silently.
do $$
begin
  if not exists (select 1 from hotel_modules where module = 'reception_pos') then
    insert into hotel_modules (hotel_id, module, is_enabled)
    select id, 'reception_pos', true from hotels;
  end if;
end $$;

-- The question the till asks. Reception needs the switch; every other role at
-- the hotel, and a group administrator, is answered as before.
create or replace function app.may_use_pos(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin()
      or exists (
           select 1
             from staff_hotels sh
            where sh.staff_id = app.current_user_id()
              and sh.hotel_id = p_hotel
              and (sh.role <> 'front_desk'
                   or app.module_enabled(p_hotel, 'reception_pos'))
         );
$$;

comment on function app.may_use_pos(uuid) is
  'Whether the signed-in person may use this hotel''s till and kitchen. '
  'Reception only when the hotel''s reception_pos module is on (087).';

grant execute on function app.may_use_pos(uuid) to pms_app;
