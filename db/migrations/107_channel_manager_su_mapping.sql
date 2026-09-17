-- =============================================================================
-- 107 · The SU channel manager: what each hotel sends to SU, and under which ids
-- =============================================================================
-- D17-66 (17 September): the owner chose SU and asked for the connection to be
-- built. Part 2 of four: the CONTENT — the hotel, its room types and its rate
-- plans — sent from the PMS, which is the record (D17-28).
--
-- SU works with the ids the PMS gives it. A hotel is `hotelid`, a room type is
-- `roomid`, a rate plan is `rateplanid`; each is at most 20 letters, digits and
-- hyphens, and SU refuses a second room with an id it has seen. Once rooms and
-- rates are pushed and bookings pulled under those ids, changing one is a new
-- room on SU, so the ids are STORED, chosen by a person, and never derived again
-- from a name somebody might edit.
--
-- WHAT SU REQUIRES THAT THE PMS DOES NOT HOLD is kept here and typed by a person:
-- a postcode, a country, the hotel's position, a contact's first and last name
-- (SU's property content), and how many of a room's guests may be children (SU's
-- room content). Nothing is filled in by this migration; an empty value is a
-- refusal to send, naming what is missing, never a guess.
--
-- A RATE PLAN IS A MEAL PLAN. The PMS prices a room type per meal plan per date
-- (033, 052), so a rate plan on SU is one of the meal plans a hotel sells online,
-- with SU's own meal-plan code beside it (SU: 15 Room only, 2 Breakfast, 14 Half
-- board, 13 Full board, 1 All inclusive, …) — chosen by a person, not mapped here.
--
-- NOT HERE: switching a hotel on (D17-45) is the master's module switch, read as
-- app.module_enabled(hotel, 'channel_manager'), false until it exists and until
-- somebody turns it on. No rows are created for any hotel.
--
-- Re-runnable: every statement guards itself, and it touches no table it does
-- not create.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The hotel on SU
-- -----------------------------------------------------------------------------
create table if not exists channel_hotels (
  hotel_id            uuid primary key references hotels(id) on delete cascade,
  su_hotel_id         text not null,
  postal_code         text,
  country_code        text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  contact_first_name  text,
  contact_last_name   text,
  description         text,
  -- Whether SU has this property: set by the first send SU accepted, so every
  -- later send is an update ("Overlay") rather than a second "New".
  on_su               boolean not null default false,
  -- What SU said the last time the content went, in words. Null: never sent.
  content_sent_at     timestamptz,
  content_result      text,
  content_ok          boolean,
  updated_by          uuid references staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint channel_hotels_su_hotel_id_format
    check (su_hotel_id ~ '^[A-Za-z0-9-]{1,20}$'),
  constraint channel_hotels_country_format
    check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  constraint channel_hotels_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint channel_hotels_longitude_range
    check (longitude is null or longitude between -180 and 180),
  constraint channel_hotels_description_length
    check (description is null or length(description) <= 2000)
);

-- One SU property per id across the group: SU's hotelid is unique to the partner.
create unique index if not exists channel_hotels_su_hotel_id_unique
  on channel_hotels (upper(su_hotel_id));

comment on table channel_hotels is
  'A hotel''s identity on SU (the Su channel manager, D17-66) and the property '
  'content SU requires that the hotel record does not hold. Typed by a person; '
  'nothing here is derived or defaulted.';


-- -----------------------------------------------------------------------------
-- Its room types on SU
-- -----------------------------------------------------------------------------
create table if not exists channel_room_types (
  room_type_id   uuid primary key,
  hotel_id       uuid not null,
  su_room_id     text not null,
  -- SU's room type list: 9 Double, 8 Twin, 7 Triple, 5 Suite, 13 Family, …
  su_room_type   smallint not null,
  -- SU: "Maximum number of children … must be less than Maximum Occupancy".
  max_children   smallint not null,
  is_connected   boolean not null default false,
  -- What SU has, as far as its answers say: null never created, active, or
  -- deactivated. Moved only by an answer SU accepted.
  on_su          text,
  -- The last send: what SU was asked to do and what it said.
  sent_at        timestamptz,
  sent_as        text,
  sent_result    text,
  sent_ok        boolean,
  updated_by     uuid references staff(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  foreign key (hotel_id, room_type_id)
    references room_types (hotel_id, id) on delete cascade,
  constraint channel_room_types_su_room_id_format
    check (su_room_id ~ '^[A-Za-z0-9-]{1,20}$'),
  constraint channel_room_types_su_room_type_known
    check (su_room_type > 0),
  constraint channel_room_types_children_sane
    check (max_children >= 0),
  constraint channel_room_types_sent_as_known
    check (sent_as is null or sent_as in ('created', 'updated', 'deactivated', 'activated')),
  constraint channel_room_types_on_su_known
    check (on_su is null or on_su in ('active', 'deactivated'))
);

create unique index if not exists channel_room_types_su_room_id_unique
  on channel_room_types (hotel_id, upper(su_room_id));

comment on table channel_room_types is
  'Which room types a hotel sends to SU, under which SU room id. A room type '
  'stays here once sent: taking it off SU is is_connected = false and a '
  '"Deactivated" to SU, never a deleted row, so its id is never reused.';


-- -----------------------------------------------------------------------------
-- Its rate plans on SU — one per meal plan sold online
-- -----------------------------------------------------------------------------
create table if not exists channel_rate_plans (
  hotel_id         uuid not null references hotels(id) on delete cascade,
  meal_plan        text not null references meal_plans(code),
  su_rate_plan_id  text not null,
  su_meal_plan     smallint not null,
  is_connected     boolean not null default false,
  on_su            text,
  sent_at          timestamptz,
  sent_as          text,
  sent_result      text,
  sent_ok          boolean,
  updated_by       uuid references staff(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  primary key (hotel_id, meal_plan),
  constraint channel_rate_plans_su_id_format
    check (su_rate_plan_id ~ '^[A-Za-z0-9-]{1,20}$'),
  constraint channel_rate_plans_su_meal_plan_known
    check (su_meal_plan > 0),
  constraint channel_rate_plans_sent_as_known
    check (sent_as is null or sent_as in ('created', 'updated', 'deactivated', 'activated')),
  constraint channel_rate_plans_on_su_known
    check (on_su is null or on_su in ('active', 'deactivated'))
);

create unique index if not exists channel_rate_plans_su_id_unique
  on channel_rate_plans (hotel_id, upper(su_rate_plan_id));

comment on table channel_rate_plans is
  'Which meal plans a hotel sells through SU, each as an SU rate plan with SU''s '
  'meal-plan code. Taken off SU by is_connected = false, never deleted.';


-- -----------------------------------------------------------------------------
-- Who sees and writes them: the hotel's own people, and every write audited
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['channel_hotels', 'channel_room_types', 'channel_rate_plans'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format(
      'create policy hotel_isolation on %I for all '
      'using ( hotel_id in (select app.auth_hotel_ids()) ) '
      'with check ( hotel_id in (select app.auth_hotel_ids()) )', t);
    execute format('grant select, insert, update on %I to pms_app', t);
    execute format('revoke delete on %I from pms_app', t);

    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on %I '
      'for each row execute function app.write_audit()', t || '_audit', t);

    execute format('drop trigger if exists %I on %I', t || '_updated_by_scope', t);
    execute format(
      'create trigger %I before insert or update on %I '
      'for each row execute function app.assert_staff_has_hotel(''updated_by'')',
      t || '_updated_by_scope', t);
  end loop;
end $$;
