-- =============================================================================
-- 060 — the banquet hall
-- =============================================================================
-- `041_hotel_modules.sql` has carried a flag called `banquet` since it was
-- written, defaulting OFF, with a comment saying why: *"banquet is not built."*
-- This is the thing it was waiting for.
--
-- WHAT A BANQUET BOOKING IS, from the group's own description of it:
--
--   "the banquet is booked for events so it needs to be specified till when
--    the hall is booked till, so it is the GM responsibility and he needs to
--    register"
--
-- Three requirements sit in that sentence and the model follows them exactly.
--
-- 1 · A TIME RANGE, NOT A DATE. A room is sold by the night, so
--     `room_assignments` uses `daterange`. A hall is not: it is taken from six
--     in the evening until midnight, and a different party can have it from
--     eight the next morning. Booked BY DATE, one wedding would consume a day
--     that could hold three functions — and a hall the GM knows is free would
--     read as sold. `tstzrange`, half-open, like every other range here.
--
--     The same shape covers a three-day wedding without a second idea: it is
--     one range that happens to be long.
--
-- 2 · SOMEBODY REGISTERED IT. `registered_by` is NOT NULL. A hall that is
--     "booked" with nobody's name against it is the state this is meant to
--     end — the question is never *is it free*, it is *who said so*.
--
-- 3 · TILL WHEN. `ends_at` is NOT NULL and must be after `starts_at`. An
--     open-ended hall booking is the thing being fixed, so the schema cannot
--     express one.
--
-- NO DEFAULT PRICE, the same rule as everywhere else. A venue MAY carry a
-- `default_rate`, because the group asked for one — *"it is customized so
-- there is no fixed price but also keep the option to set default price"* —
-- and it is NULL until a person types it. An event's `agreed_amount` is
-- likewise nullable, and NULL means UNPRICED, never free. Nothing in this
-- file writes a number nobody chose.
--
-- AN ENQUIRY DOES NOT HOLD THE HALL. Only a confirmed booking does. Two
-- families asking about the same Saturday is the normal case and refusing the
-- second is wrong; two families both told yes is the fault worth a constraint.
-- =============================================================================

create extension if not exists btree_gist;


-- -----------------------------------------------------------------------------
-- The halls
-- -----------------------------------------------------------------------------
-- NO DEFAULT VENUES. A property with a banquet hall has somebody enter it,
-- exactly as rooms are entered. Shipping "Main Hall" at every property would
-- put a room on the floor that nobody has ever seen.
-- -----------------------------------------------------------------------------
create table if not exists banquet_venues (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  name          text not null,

  -- Two capacities, because they are genuinely different numbers and a hall
  -- sold on the wrong one seats a wedding that does not fit. Both nullable:
  -- an unmeasured hall says so rather than claiming zero.
  seated_capacity   int,
  floating_capacity int,

  -- The optional default the group asked for. NULL is the shipped state.
  -- A number here is a STARTING POINT the screen offers; it is never what
  -- gets billed, because what gets billed is snapshotted onto the event.
  default_rate  numeric(12,2),

  is_active     boolean not null default true,
  sort_order    int not null default 0,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint bv_name_present  check (length(trim(name)) > 0),
  constraint bv_seated_sane   check (seated_capacity   is null or seated_capacity   > 0),
  constraint bv_floating_sane check (floating_capacity is null or floating_capacity > 0),
  constraint bv_rate_sane     check (default_rate is null or default_rate >= 0),
  constraint bv_name_unique   unique (hotel_id, name)
);

comment on table banquet_venues is
  'The halls a property can sell. NO VENUE IS SHIPPED and default_rate is NULL '
  'until somebody types one -- a default price is an option the group asked '
  'for, not a number this system invents.';

comment on column banquet_venues.default_rate is
  'A starting point the booking screen offers. Never billed directly: the '
  'amount actually agreed is snapshotted onto the event, so changing this '
  'cannot reprice a function that is already sold.';


-- -----------------------------------------------------------------------------
-- The events
-- -----------------------------------------------------------------------------
create table if not exists banquet_events (
  id            uuid not null default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  venue_id      uuid not null references banquet_venues(id),
  reference     text not null,

  -- What it is. "Sharma sangeet", "Rotary AGM". The name a GM uses on the
  -- phone, which is the name that has to appear on the calendar.
  title         text not null,
  event_type    text,

  -- TILL WHEN. Both required; half-open, so an event ending at 23:00 and one
  -- starting at 23:00 do not overlap.
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,

  -- The operating day it belongs to, for the day's reports. Derived from the
  -- hotel's business date by the caller, never from now().
  business_date date not null,

  status        text not null default 'enquiry',

  -- Who it is for. A host may be a walk-in name and phone with no guest row,
  -- an existing guest, or a company — the same three ways a folio bills.
  host_name     text not null,
  host_phone    text,
  host_email    text,
  guest_id      uuid references guests(id),
  company_id    uuid references companies(id),

  -- Expected heads. Nullable: "about two hundred" is not yet a number, and
  -- writing 0 would read as an event nobody is coming to.
  pax_expected   int,
  pax_guaranteed int,

  -- WHAT WAS AGREED, snapshotted. NULL means nobody has priced it yet, which
  -- the screens render as a dash. `app.tariff_for` sets the precedent: an
  -- unpriced thing makes the total NULL rather than adding zero.
  agreed_amount numeric(12,2),

  -- THE GM'S NAME AGAINST IT. Not nullable, and not defaulted.
  registered_by uuid not null references staff(id),
  registered_at timestamptz not null default now(),

  confirmed_by  uuid references staff(id),
  confirmed_at  timestamptz,
  cancelled_by  uuid references staff(id),
  cancelled_at  timestamptz,
  cancel_reason text,

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (id),
  unique (hotel_id, id),
  constraint be_reference_unique unique (hotel_id, reference),

  constraint be_title_present check (length(trim(title)) > 0),
  constraint be_host_present  check (length(trim(host_name)) > 0),

  -- TILL WHEN, enforced. An event that ends before it starts is a typo that
  -- would otherwise sit in the calendar as a hall free all evening.
  constraint be_ends_after_start check (ends_at > starts_at),

  constraint be_status_known check
    (status in ('enquiry', 'confirmed', 'cancelled', 'completed')),

  -- A cancellation says why. The same rule the folio adjustment follows:
  -- the reason is the thing somebody asks about a month later.
  constraint be_cancel_has_reason check
    (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) > 0),

  constraint be_pax_sane    check (pax_expected   is null or pax_expected   > 0),
  constraint be_guar_sane   check (pax_guaranteed is null or pax_guaranteed > 0),
  constraint be_amount_sane check (agreed_amount is null or agreed_amount >= 0),

  -- One host, at most. A booking billed to both a guest and a company is a
  -- question at settlement nobody can answer.
  constraint be_one_host check (guest_id is null or company_id is null)
);

/* ---- the hall cannot be sold twice --------------------------------------
   The whole reason this module exists. `status <> 'cancelled'` would let an
   ENQUIRY block the hall, and that is wrong: two families asking about the
   same Saturday is normal business, and refusing the second loses one of
   them. Two families both told YES is the fault worth a constraint, so only
   `confirmed` holds the room.

   Half-open, so a function ending at 23:00 and one starting at 23:00 sit
   beside each other rather than overlapping. */
alter table banquet_events drop constraint if exists be_no_double_booking;
alter table banquet_events add constraint be_no_double_booking
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed');

comment on table banquet_events is
  'A function in a hall, held for an explicit time range. Only a CONFIRMED '
  'event holds the venue -- an enquiry does not, because two families asking '
  'about one Saturday is normal and two families both told yes is not.';

comment on column banquet_events.registered_by is
  'Who took responsibility. Not nullable: a hall booked with nobody''s name '
  'against it is the state this module exists to end.';

comment on column banquet_events.agreed_amount is
  'What was agreed, snapshotted at booking like reservations.agreed_rate. NULL '
  'means UNPRICED, which the screens show as a dash -- never as free.';

create index if not exists banquet_events_hotel_time_idx
  on banquet_events (hotel_id, starts_at);
create index if not exists banquet_events_venue_time_idx
  on banquet_events (venue_id, starts_at) where status <> 'cancelled';
create index if not exists banquet_events_date_idx
  on banquet_events (hotel_id, business_date);


-- -----------------------------------------------------------------------------
-- A folio for the event
-- -----------------------------------------------------------------------------
-- `folios_belongs_to_one` says a folio belongs to EXACTLY ONE of a reservation
-- or a group. An event is a third thing that gets billed, and without widening
-- that constraint every attempt to open an event folio is refused by a CHECK
-- whose message names neither events nor the reason.
-- -----------------------------------------------------------------------------
alter table folios add column if not exists event_id uuid references banquet_events(id);

create index if not exists folios_event_idx on folios (event_id) where event_id is not null;

alter table folios drop constraint if exists folios_belongs_to_one;
alter table folios add constraint folios_belongs_to_one check (
  (case when reservation_id is not null then 1 else 0 end
 + case when group_id       is not null then 1 else 0 end
 + case when event_id       is not null then 1 else 0 end) = 1
);

comment on constraint folios_belongs_to_one on folios is
  'A folio bills exactly one thing: a stay, a group master, or a banquet '
  'event. Widened from two to three by 060 -- an event folio was refused '
  'before that, by a CHECK that could not say why.';

-- One open folio per event, the same guard `folios_one_open_master` gives a
-- group. Two open folios for one function is a bill somebody settles half of.
create unique index if not exists folios_one_open_event
  on folios (event_id) where event_id is not null and status = 'open';


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table banquet_venues enable row level security;
alter table banquet_venues force  row level security;
drop policy if exists banquet_venues_isolation on banquet_venues;
create policy banquet_venues_isolation on banquet_venues
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table banquet_events enable row level security;
alter table banquet_events force  row level security;
drop policy if exists banquet_events_isolation on banquet_events;
create policy banquet_events_isolation on banquet_events
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists banquet_venues_touch on banquet_venues;
create trigger banquet_venues_touch before update on banquet_venues
  for each row execute function app.touch_updated_at();

drop trigger if exists banquet_events_touch on banquet_events;
create trigger banquet_events_touch before update on banquet_events
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- The venue has to belong to the property
-- -----------------------------------------------------------------------------
-- RLS scopes what a session can SEE, which is not the same as what it can
-- WRITE across properties it can see. A group admin sees every hotel, so
-- without this an event at Akkalkot could be booked into Pune's hall and both
-- calendars would look right. The same fault 058 guards for work orders.
-- -----------------------------------------------------------------------------
create or replace function app.banquet_venue_is_here()
returns trigger language plpgsql as $$
declare v_hotel uuid;
begin
  select hotel_id into v_hotel from banquet_venues where id = new.venue_id;
  if v_hotel is null then
    raise exception 'that hall does not exist';
  end if;
  if v_hotel <> new.hotel_id then
    raise exception 'that hall belongs to another property'
      using hint = 'A function is booked into a hall at the same hotel.';
  end if;
  return new;
end $$;

drop trigger if exists banquet_events_venue_here on banquet_events;
create trigger banquet_events_venue_here
  before insert or update of venue_id, hotel_id on banquet_events
  for each row execute function app.banquet_venue_is_here();


-- -----------------------------------------------------------------------------
-- What is in the hall, and what clashes with it
-- -----------------------------------------------------------------------------
-- ONE DEFINITION. The calendar, the booking form and the API refusal all ask
-- this the same way, because a rule written in three places is wrong in one —
-- and here "wrong" means a hall sold twice.
-- -----------------------------------------------------------------------------
drop function if exists app.banquet_conflicts(uuid, timestamptz, timestamptz, uuid);
create function app.banquet_conflicts(
  p_venue  uuid,
  p_from   timestamptz,
  p_to     timestamptz,
  p_except uuid default null      -- the event being edited holds itself
)
returns table (
  id        uuid,
  reference text,
  title     text,
  starts_at timestamptz,
  ends_at   timestamptz
)
language sql stable as $$
  select e.id, e.reference, e.title, e.starts_at, e.ends_at
    from banquet_events e
   where e.venue_id = p_venue
     and e.status = 'confirmed'
     and (p_except is null or e.id <> p_except)
     and tstzrange(e.starts_at, e.ends_at, '[)')
      && tstzrange(p_from, p_to, '[)')
   order by e.starts_at;
$$;

comment on function app.banquet_conflicts(uuid, timestamptz, timestamptz, uuid) is
  'Confirmed events standing in the way of a proposed booking. Returns the '
  'rows rather than a boolean so a refusal can NAME what is in the hall: '
  '"the Sharma sangeet, until 23:00" is actionable, "unavailable" is not.';


-- -----------------------------------------------------------------------------
-- Confirming an event
-- -----------------------------------------------------------------------------
-- The moment the hall is actually taken, so it is the moment worth guarding.
-- IT LIVES HERE, NOT IN THE API, for the reason 040 and 053 give: the screen
-- is not the only caller, and two callers doing the same arithmetic is how
-- two systems come to disagree.
-- -----------------------------------------------------------------------------
drop function if exists app.confirm_banquet_event(uuid, uuid);
create function app.confirm_banquet_event(p_event uuid, p_by uuid)
returns uuid                       -- the folio the event will bill to
language plpgsql as $$
declare
  e       record;
  v_clash record;
  v_folio uuid;
begin
  select * into e from banquet_events where id = p_event for update;
  if not found then
    raise exception 'no such event';
  end if;

  if e.status = 'cancelled' then
    raise exception 'that function was cancelled'
      using hint = 'Register it again rather than reviving the cancelled one, '
                   'so the cancellation stays on the record.';
  end if;

  /* Named, not merely refused. The exclusion constraint would catch this
     anyway, but it would say "conflicting key value violates exclusion
     constraint" — true, and useless to a GM holding a telephone. */
  select * into v_clash
    from app.banquet_conflicts(e.venue_id, e.starts_at, e.ends_at, e.id) limit 1;
  if found then
    raise exception 'the hall is taken: % (%), % to %',
      v_clash.title, v_clash.reference,
      to_char(v_clash.starts_at, 'DD Mon HH24:MI'),
      to_char(v_clash.ends_at,   'DD Mon HH24:MI')
      using hint = 'Move this function, or cancel the one holding the hall.';
  end if;

  update banquet_events
     set status = 'confirmed', confirmed_by = p_by, confirmed_at = now()
   where id = p_event;

  /* The folio opens ON CONFIRMATION, not at registration. An enquiry that
     never became a booking should not leave an empty bill behind for
     somebody to wonder about. */
  select id into v_folio from folios
   where event_id = p_event and status = 'open';
  if v_folio is null then
    insert into folios (hotel_id, event_id, bill_to, company_id)
    values (e.hotel_id, p_event,
            case when e.company_id is not null then 'company' else 'guest' end,
            e.company_id)
    returning id into v_folio;
  end if;

  return v_folio;
end $$;

comment on function app.confirm_banquet_event(uuid, uuid) is
  'Takes the hall. Names the event standing in the way rather than letting '
  'the exclusion constraint answer, and opens the folio the function bills '
  'to -- on confirmation, so an enquiry that went nowhere leaves no empty bill.';


-- -----------------------------------------------------------------------------
-- The calendar
-- -----------------------------------------------------------------------------
drop function if exists app.banquet_calendar(uuid, date, date);
create function app.banquet_calendar(p_hotel uuid, p_from date, p_to date)
returns table (
  venue_id      uuid,
  venue_name    text,
  event_id      uuid,
  reference     text,
  title         text,
  status        text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  host_name     text,
  pax_expected  int,
  agreed_amount numeric,
  registered_by text
)
language sql stable as $$
  select v.id, v.name,
         e.id, e.reference, e.title, e.status, e.starts_at, e.ends_at,
         e.host_name, e.pax_expected, e.agreed_amount, s.full_name
    from banquet_venues v
    left join banquet_events e
      on e.venue_id = v.id
     and e.status <> 'cancelled'
     and e.starts_at < (p_to + 1)::timestamptz
     and e.ends_at   > p_from::timestamptz
    left join staff s on s.id = e.registered_by
   where v.hotel_id = p_hotel
     and v.is_active
   order by v.sort_order, v.name, e.starts_at;
$$;

comment on function app.banquet_calendar(uuid, date, date) is
  'Every active hall over a window, with whatever is in it. LEFT JOINed on '
  'purpose: a hall with nothing booked is a row with nulls, because an empty '
  'hall is the answer somebody is looking for.';


grant select, insert, update on banquet_venues to pms_app;
grant select, insert, update on banquet_events to pms_app;
grant execute on function app.banquet_conflicts(uuid, timestamptz, timestamptz, uuid) to pms_app;
grant execute on function app.confirm_banquet_event(uuid, uuid) to pms_app;
grant execute on function app.banquet_calendar(uuid, date, date) to pms_app;
