-- =============================================================================
-- NNN · The spa — treatments, a day diary, and what was agreed for each
-- =============================================================================
-- The owner's D17-54 and D18-6, built behind the switch 115 made. `spa` is a
-- module a property is switched on for; nothing here is reachable where it is
-- off, and the routes ask `app.module_enabled(hotel, 'spa')` before they
-- answer — hiding a screen is not disabling it (041's own words).
--
-- WHAT A SPA BOOKING IS, from the brief: "who, which treatment, which
-- therapist (a name, not an account), what time". Three things follow from
-- that sentence and the model follows them exactly.
--
-- 1 · A TIME RANGE, NOT A DATE. A therapist gives a massage from eleven to
--     twelve and another from twelve to one. Booked BY DATE, one treatment
--     would consume a day. `tstzrange`, half-open, like the hall in 060 and
--     like every other range here.
--
-- 2 · ONE THERAPIST IS NOT IN TWO PLACES AT ONCE. That is the guard this
--     module exists for, and it is an exclusion constraint rather than a
--     query the screen runs, for the reason 060 gives: the screen is not the
--     only caller. `app.book_spa_appointment` NAMES the appointment standing
--     in the way, because "conflicting key value violates exclusion
--     constraint" is true and useless to a receptionist holding a telephone.
--
--     Unlike the hall, a booking holds the therapist from the moment it is
--     made. A hall has enquiries, which is why 060 holds it only on
--     `confirmed`; a spa appointment taken on the telephone is the booking.
--     So everything but a cancellation occupies the slot — including one
--     already given, which occupied it at the time.
--
-- 3 · A THERAPIST IS A NAME, NOT AN ACCOUNT. No therapist signs in; reception
--     runs these screens (D18-8). But the names are a LIST, not free text: two
--     spellings of one person are two people to a database, and the overlap
--     rule would then hold for neither.
--
-- NO DEFAULT PRICES, the same rule as everywhere else. A treatment's `price`
-- is NULL until somebody types one, which the screens show as a dash and never
-- as free. `agreed_amount` is snapshotted onto the appointment at booking, as
-- `reservations.agreed_rate` and `banquet_events.agreed_amount` are, so
-- repricing the list cannot reprice a treatment already given — and an
-- appointment nobody has priced CANNOT BE CLOSED, because closing it is the
-- moment money is either taken or put on a bill.
--
-- A TIME BELONGS TO THE PROPERTY (113, root MEMORY 297). Nothing here stores
-- a bare timestamp: the routes write through `app.hotel_moment` and read
-- through `app.hotel_clock`. The hotel's server runs in GMT.
--
-- EVERY APPOINTMENT IS AGAINST A STAY. `reservation_id` is NOT NULL: a walk-in
-- who is not staying is a bill with no stay behind it, and the brief excludes
-- it from this version until the owner has been asked. The schema cannot
-- express one, which is the point — it refuses what was not decided rather
-- than half-supporting it.
-- =============================================================================

create extension if not exists btree_gist;


-- -----------------------------------------------------------------------------
-- The spa bills under its own GST rule
-- -----------------------------------------------------------------------------
-- THE OWNER'S ANSWER, 18 September, asked because there was no answer to read:
-- a treatment bills under its OWN rate, not the room's and not "other". So the
-- spa's rate is set per property like every other kind, and a property that has
-- not set one CANNOT BILL A TREATMENT -- `app.gst_rate` raises rather than
-- falling back, which is the no-default-prices rule applied to tax. Nothing is
-- shipped; the owner types the number once per hotel.
--
-- ⚠ GUARDED BY WHAT IT ADDS, and that is not politeness. Every deploy replays
-- every migration from 001. 067 is the ONLY file that defines this constraint
-- today -- checked, because MEMORY 299's rule is to grep the whole family
-- rather than fix the file in front of you -- but the moment a later file
-- rewrites it, an unguarded version of this would put the narrow list back over
-- rows that already exist and stop every deploy after the first spa charge.
-- That is 284, 293 and 299, three times in two days, and all three were this
-- shape.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'tax_rules'::regclass
       and conname  = 'tax_rules_kind_known'
       and pg_get_constraintdef(oid) like '%spa%'
  ) then
    alter table tax_rules drop constraint if exists tax_rules_kind_known;
    alter table tax_rules add constraint tax_rules_kind_known
      check (kind in ('room', 'restaurant', 'bar', 'banquet', 'spa', 'other'));
  end if;
end $$;

comment on constraint tax_rules_kind_known on tax_rules is
  'The kinds of supply a property sells under. Widened from five to six by '
  '116 -- the spa bills under its own rate (the owner, 18 September), so a '
  'property sets it once and a property that has not set it cannot bill a '
  'treatment.';


-- -----------------------------------------------------------------------------
-- The price list
-- -----------------------------------------------------------------------------
-- NO TREATMENTS ARE SHIPPED. A property with a spa has somebody enter its
-- list, exactly as rooms and halls are entered. Shipping "Swedish massage" at
-- every property would put something on a menu nobody has ever sold.
-- -----------------------------------------------------------------------------
create table if not exists spa_treatments (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  name          text not null,

  -- HOW LONG. Not nullable: the diary places a booking by its length, and a
  -- treatment with no length cannot be put in a day. This is the one field of
  -- the three that the schema insists on.
  minutes       int not null,

  -- THE PRICE, and NULL is the shipped state. NULL means nobody has priced
  -- this, which reads as a dash — never as free, and never as zero.
  price         numeric(12,2),

  is_active     boolean not null default true,
  sort_order    int not null default 0,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint st_name_present  check (length(trim(name)) > 0),
  constraint st_minutes_sane  check (minutes > 0 and minutes <= 600),
  constraint st_price_sane    check (price is null or price >= 0),
  constraint st_name_unique   unique (hotel_id, name)
);

comment on table spa_treatments is
  'What a property''s spa sells. NO TREATMENT IS SHIPPED and price is NULL '
  'until somebody types one -- an unpriced treatment shows a dash and cannot '
  'be closed for money.';

comment on column spa_treatments.price is
  'What the list says today. Snapshotted onto an appointment when it is '
  'booked, so changing this cannot reprice a treatment already given.';


-- -----------------------------------------------------------------------------
-- The therapists
-- -----------------------------------------------------------------------------
-- A NAME, NOT AN ACCOUNT (D18-8: no therapist logins, no new roles). A list
-- rather than a text box, because the whole guard below is "this person is
-- already busy", and that question cannot be asked of a string somebody typed
-- twice.
-- -----------------------------------------------------------------------------
create table if not exists spa_therapists (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  name          text not null,

  is_active     boolean not null default true,
  sort_order    int not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sth_name_present check (length(trim(name)) > 0),
  constraint sth_name_unique  unique (hotel_id, name)
);

comment on table spa_therapists is
  'Who gives the treatments. A name the diary books against, not somebody who '
  'signs in -- D18-8: no therapist logins and no new staff roles.';


-- -----------------------------------------------------------------------------
-- The day diary
-- -----------------------------------------------------------------------------
create table if not exists spa_appointments (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,

  -- WHO. Against a stay, always (see the header). The guest's name is read
  -- through the stay rather than copied here: one name, one place it is
  -- corrected.
  reservation_id uuid not null references reservations(id),

  treatment_id   uuid not null references spa_treatments(id),
  therapist_id   uuid not null references spa_therapists(id),

  -- WHAT TIME. Both required, half-open, so an appointment ending at 12:00
  -- and one starting at 12:00 sit beside each other rather than overlapping.
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,

  -- The operating day it belongs to, for the day's reports. From the hotel's
  -- business date, never from now().
  business_date  date not null,

  status         text not null default 'booked',

  -- WHAT WAS AGREED, snapshotted at booking. NULL means UNPRICED, which the
  -- screens render as a dash and which refuses to be closed.
  agreed_amount  numeric(12,2),

  -- WHO TOOK IT. Not nullable and not defaulted: an appointment in the diary
  -- with nobody's name against it is the state this exists to end.
  booked_by      uuid not null references staff(id),
  booked_at      timestamptz not null default now(),

  -- HOW IT WAS CLOSED (D18-6): settled at the spa, or charged to the room.
  -- Both null until it is closed; `settlement` is the choice made then.
  settlement     text,
  closed_by      uuid references staff(id),
  closed_at      timestamptz,

  -- The line it became on the bill, when it went to the room. Kept so the
  -- diary and the bill can never disagree about whether it was charged, and
  -- so a reversal can find its way back.
  posting_id     bigint references folio_postings(id),

  cancelled_by   uuid references staff(id),
  cancelled_at   timestamptz,
  cancel_reason  text,

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint sa_ends_after_start check (ends_at > starts_at),

  constraint sa_status_known check
    (status in ('booked', 'completed', 'cancelled')),

  -- A cancellation says why -- the rule the folio adjustment and the banquet
  -- cancellation both follow. The reason is the thing somebody asks about a
  -- month later.
  constraint sa_cancel_has_reason check
    (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) > 0),

  constraint sa_amount_sane check (agreed_amount is null or agreed_amount >= 0),

  constraint sa_settlement_known check
    (settlement is null or settlement in ('room', 'spa')),

  -- CLOSED MEANS SETTLED, AND SETTLED MEANS CLOSED. A completed treatment
  -- with no settlement is money nobody can account for; a settlement on one
  -- that never happened is worse.
  constraint sa_completed_is_settled check
    ((status = 'completed') = (settlement is not null)),

  -- And a closed one names who closed it and when.
  constraint sa_closed_has_hand check
    ((settlement is null) = (closed_by is null)
     and (settlement is null) = (closed_at is null)),

  -- A posting belongs to the room settlement and to nothing else.
  constraint sa_posting_is_a_room_charge check
    (posting_id is null or settlement = 'room')
);

/* ---- one therapist is not in two places at once -------------------------
   The whole reason this module exists. Unlike the hall in 060, a booking
   holds the therapist from the moment it is taken: a spa appointment made on
   the telephone IS the booking, and there is no enquiry to hold nothing.
   A cancelled one releases the slot; a completed one does not, because it
   occupied that slot when it happened. */
alter table spa_appointments drop constraint if exists sa_one_therapist_at_a_time;
alter table spa_appointments add constraint sa_one_therapist_at_a_time
  exclude using gist (
    therapist_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled');

comment on table spa_appointments is
  'A treatment in the diary: which guest, which treatment, which therapist, '
  'what time. Every one is against a stay -- a walk-in who is not staying is '
  'a bill with no stay behind it, and is not in this version.';

comment on column spa_appointments.agreed_amount is
  'What was agreed, snapshotted at booking like banquet_events.agreed_amount. '
  'NULL means UNPRICED, which shows as a dash and refuses to be closed.';

comment on constraint sa_one_therapist_at_a_time on spa_appointments is
  'One therapist, one appointment at a time. Half-open, so eleven-to-twelve '
  'and twelve-to-one do not collide. A cancellation releases the slot; a '
  'completed treatment does not, because it occupied it.';

create index if not exists spa_appointments_hotel_time_idx
  on spa_appointments (hotel_id, starts_at);
create index if not exists spa_appointments_therapist_time_idx
  on spa_appointments (therapist_id, starts_at) where status <> 'cancelled';
create index if not exists spa_appointments_date_idx
  on spa_appointments (hotel_id, business_date);
create index if not exists spa_appointments_stay_idx
  on spa_appointments (reservation_id);


-- -----------------------------------------------------------------------------
-- Hotel isolation
-- -----------------------------------------------------------------------------
alter table spa_treatments enable row level security;
alter table spa_treatments force  row level security;
drop policy if exists spa_treatments_isolation on spa_treatments;
create policy spa_treatments_isolation on spa_treatments
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table spa_therapists enable row level security;
alter table spa_therapists force  row level security;
drop policy if exists spa_therapists_isolation on spa_therapists;
create policy spa_therapists_isolation on spa_therapists
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table spa_appointments enable row level security;
alter table spa_appointments force  row level security;
drop policy if exists spa_appointments_isolation on spa_appointments;
create policy spa_appointments_isolation on spa_appointments
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists spa_treatments_touch on spa_treatments;
create trigger spa_treatments_touch before update on spa_treatments
  for each row execute function app.touch_updated_at();

drop trigger if exists spa_therapists_touch on spa_therapists;
create trigger spa_therapists_touch before update on spa_therapists
  for each row execute function app.touch_updated_at();

drop trigger if exists spa_appointments_touch on spa_appointments;
create trigger spa_appointments_touch before update on spa_appointments
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- What stands in the way
-- -----------------------------------------------------------------------------
-- Named, not merely refused. The exclusion constraint would catch a clash
-- anyway and say so in a sentence no receptionist can act on.
-- -----------------------------------------------------------------------------
drop function if exists app.spa_conflicts(uuid, timestamptz, timestamptz, uuid);
create function app.spa_conflicts(
  p_therapist uuid, p_from timestamptz, p_to timestamptz, p_except uuid default null
)
returns table (
  id uuid, starts_at timestamptz, ends_at timestamptz,
  treatment text, guest_name text
)
language sql
stable
as $fn$
  select a.id, a.starts_at, a.ends_at, t.name,
         /* The stay's guest, through the same left join the rest of the
            system uses for a label on a row-secured table (root MEMORY 283):
            a missing name is a dash, never a missing row. */
         g.full_name
    from spa_appointments a
    join spa_treatments t on t.id = a.treatment_id
    left join reservations r on r.id = a.reservation_id
    left join guests g      on g.id = r.guest_id
   where a.therapist_id = p_therapist
     and a.status <> 'cancelled'
     and (p_except is null or a.id <> p_except)
     and tstzrange(a.starts_at, a.ends_at, '[)')
      && tstzrange(p_from, p_to, '[)')
   order by a.starts_at;
$fn$;

comment on function app.spa_conflicts(uuid, timestamptz, timestamptz, uuid) is
  'Which appointments a therapist already has across a window. What the diary '
  'names when it refuses an overlap.';


-- -----------------------------------------------------------------------------
-- Taking a booking
-- -----------------------------------------------------------------------------
-- IT LIVES HERE, NOT IN THE API, for the reason 040, 053 and 060 all give: the
-- screen is not the only caller. The guest's own page books a treatment too
-- (D18-6), through the master's door, and two callers doing this arithmetic
-- twice is how two systems come to disagree about who is busy.
--
-- THE LENGTH COMES FROM THE TREATMENT. The caller says when it starts; the
-- list says how long it takes. A caller that could also say when it ends
-- could book a ninety-minute massage into a thirty-minute slot.
-- -----------------------------------------------------------------------------
drop function if exists app.book_spa_appointment(uuid, uuid, uuid, uuid, text, uuid);
create function app.book_spa_appointment(
  p_hotel       uuid,
  p_reservation uuid,
  p_treatment   uuid,
  p_therapist   uuid,
  p_starts_local text,          -- as a person typed it, on the property's clock
  p_by          uuid
)
returns uuid
language plpgsql as $fn$
declare
  v_treat  record;
  v_ther   record;
  v_starts timestamptz;
  v_ends   timestamptz;
  v_clash  record;
  v_id     uuid;
begin
  select * into v_treat from spa_treatments
   where id = p_treatment and hotel_id = p_hotel;
  if not found then
    raise exception 'no such treatment at this property';
  end if;
  if not v_treat.is_active then
    raise exception 'that treatment is not on the list any more'
      using hint = 'Put it back on the list, or choose another.';
  end if;

  select * into v_ther from spa_therapists
   where id = p_therapist and hotel_id = p_hotel;
  if not found then
    raise exception 'no such therapist at this property';
  end if;
  if not v_ther.is_active then
    raise exception '% is not taking appointments', v_ther.name
      using hint = 'Put them back on the list, or choose somebody else.';
  end if;

  /* THE PROPERTY'S CLOCK, at both ends (113, root MEMORY 297). A bare time
     would mean the server's zone, and the hotel's server runs in GMT. */
  v_starts := app.hotel_moment(p_hotel, p_starts_local);
  if v_starts is null then
    raise exception 'an appointment needs a time';
  end if;
  v_ends := v_starts + make_interval(mins => v_treat.minutes);

  /* Named, not merely refused -- 060's rule. The constraint below would
     catch this and say "conflicting key value violates exclusion
     constraint", which is true and useless on a telephone. */
  select * into v_clash
    from app.spa_conflicts(p_therapist, v_starts, v_ends, null) limit 1;
  if found then
    raise exception '% is already with %: % at %',
      v_ther.name,
      coalesce(v_clash.guest_name, 'a guest'),
      v_clash.treatment,
      app.hotel_clock(p_hotel, v_clash.starts_at, 'DD Mon HH24:MI')
      using hint = 'Move this one, or book another therapist.';
  end if;

  insert into spa_appointments
    (hotel_id, reservation_id, treatment_id, therapist_id,
     starts_at, ends_at, business_date, agreed_amount, booked_by)
  values
    (p_hotel, p_reservation, p_treatment, p_therapist,
     v_starts, v_ends, app.business_date(p_hotel),
     /* Snapshotted, and NULL stays NULL: an unpriced treatment makes an
        unpriced appointment, which shows as a dash and cannot be closed. */
     v_treat.price, p_by)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function app.book_spa_appointment(uuid, uuid, uuid, uuid, text, uuid) is
  'Takes an appointment. Reads the length from the treatment so no caller can '
  'book ninety minutes into a thirty-minute slot, reads the time on the '
  'property''s clock (113), and NAMES the appointment in the way rather than '
  'letting the exclusion constraint answer.';


-- -----------------------------------------------------------------------------
-- The diary
-- -----------------------------------------------------------------------------
-- Every active therapist over a window, with whatever is in it. A therapist
-- with nothing booked comes back with an empty list, because "who is free" is
-- the question somebody is actually asking.
-- -----------------------------------------------------------------------------
drop function if exists app.spa_diary(uuid, date, date);
create function app.spa_diary(p_hotel uuid, p_from date, p_to date)
returns table (
  therapist_id uuid, therapist_name text,
  appointment_id uuid, status text,
  starts_at timestamptz, ends_at timestamptz,
  treatment text, minutes int,
  guest_name text, room_number text,
  agreed_amount numeric, settlement text
)
language sql
stable
as $fn$
  select th.id, th.name,
         a.id, a.status, a.starts_at, a.ends_at,
         t.name, t.minutes,
         g.full_name,
         /* THE ROOM THROUGH app.room_for (072), not a join of this file's
            own. A stay's room is `room_assignments` and has been since
            `reservations.room_id` was removed; 072 already answers "which
            room, as of this date" including the morning a guest checks out.
            A sixth spelling of that query is how five screens came to print
            five different rooms. */
         app.room_for(a.reservation_id, app.hotel_day(p_hotel, a.starts_at)),
         a.agreed_amount, a.settlement
    from spa_therapists th
    left join spa_appointments a
           on a.therapist_id = th.id
          and a.status <> 'cancelled'
          and app.hotel_day(p_hotel, a.starts_at) between p_from and p_to
    left join spa_treatments t on t.id = a.treatment_id
    /* Left joins all the way down: a row-secured table read for a LABEL never
       hides the row (root MEMORY 283). A viewer who may not see the guest gets
       a dash, not a shorter diary. */
    left join reservations r  on r.id = a.reservation_id
    left join guests g        on g.id = r.guest_id
   where th.hotel_id = p_hotel
     and th.is_active
   order by th.sort_order, th.name, a.starts_at;
$fn$;

comment on function app.spa_diary(uuid, date, date) is
  'The day''s diary, therapist by therapist, on the property''s own clock. A '
  'therapist with nothing booked is returned empty rather than dropped -- '
  '"who is free" is the question being asked.';


-- -----------------------------------------------------------------------------
-- What pms_app may do
-- -----------------------------------------------------------------------------
-- No DELETE anywhere. A treatment leaves the list by going inactive, and an
-- appointment that is not happening is CANCELLED with a reason -- the record
-- is the thing somebody asks about a month later.
-- -----------------------------------------------------------------------------
-- ⚠ AND THE REVOKE IS THE PART THAT DOES THE WORK. Granting select, insert and
-- update does NOT withhold delete: this cluster carries a DEFAULT ACL giving
-- pms_app `arwd` on every new table in `public`, so a new table arrives
-- deletable and a grant listing three privileges silently adds nothing. The
-- suite caught this claim being false the first time it was made. Every other
-- append-only table here is held by a trigger; these are held by the grant.
grant select, insert, update on spa_treatments   to pms_app;
grant select, insert, update on spa_therapists   to pms_app;
grant select, insert, update on spa_appointments to pms_app;
revoke delete on spa_treatments   from pms_app;
revoke delete on spa_therapists   from pms_app;
revoke delete on spa_appointments from pms_app;
grant execute on function app.spa_conflicts(uuid, timestamptz, timestamptz, uuid) to pms_app;
grant execute on function app.book_spa_appointment(uuid, uuid, uuid, uuid, text, uuid) to pms_app;
grant execute on function app.spa_diary(uuid, date, date) to pms_app;
