-- =============================================================================
-- 065 — swapping two guests, and what a rate includes
-- =============================================================================
-- Two things the front desk does that this system could not.
--
-- ── EXCHANGE ────────────────────────────────────────────────────────────────
-- `app.move_room` (054) moves ONE guest into a room nobody is in. That covers
-- an upgrade and a fault; it does not cover the other half of the job, which
-- is two guests trading rooms because a couple wants the quiet side or a
-- family needs the connecting pair.
--
-- AND IT CANNOT BE DONE AS TWO MOVES. `ra_no_double_booking` is an exclusion
-- constraint, so the moment A is written into B's room — before B has left it
-- — the second row collides and the whole thing rolls back. Two moves in
-- sequence do not work at any speed; the constraint is checked per statement,
-- not at commit.
--
-- So both are released FIRST and both re-assigned after, in one function and
-- therefore one transaction. Either the swap happens or neither guest moves.
-- A half-swap is two guests holding one key.
--
-- ── INCLUSIONS ──────────────────────────────────────────────────────────────
-- A rate is not only a number. "3,400 with breakfast for two and the airport
-- pickup" is one price and three promises, and the promises were nowhere —
-- `meal_plan` carries CP or MAP and stops there. So a guest arriving at
-- midnight asking about their transfer met a desk with nothing to check.
--
-- NOTHING IS PRICED HERE BY DEFAULT. An inclusion carries a `default_rate`
-- that is NULL until somebody types one, and NULL means "included, no extra
-- charge" — which is what an inclusion usually is. A number means the desk may
-- add it AND bill it, which is the other common case: the pickup is on the
-- rate for a corporate booking and chargeable for a walk-in.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Exchange
-- -----------------------------------------------------------------------------
drop function if exists app.exchange_rooms(uuid, uuid, uuid, date, text, uuid);
create function app.exchange_rooms(
  p_hotel  uuid,
  p_stay_a uuid,
  p_stay_b uuid,
  p_from   date,      -- first night in the swapped rooms
  p_reason text,
  p_by     uuid
)
returns table (room_a text, room_b text, nights int)
language plpgsql
as $$
declare
  a       record;
  b       record;
  v_a_out date;
  v_b_out date;
begin
  if p_stay_a = p_stay_b then
    raise exception 'a guest cannot swap with themselves';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'an exchange needs a reason'
      using hint = 'Two guests changed rooms — somebody will ask why.';
  end if;

  /* Locked in a fixed order, by id. Two clerks swapping the same pair from
     opposite directions would otherwise each hold what the other wants, and
     the pair would sit there until one timed out. Ordering the locks is what
     makes a deadlock impossible rather than merely unlikely. */
  perform 1 from reservations
   where id in (p_stay_a, p_stay_b) and hotel_id = p_hotel
   order by id
     for update;

  select ra.id, ra.room_id, ra.from_date, ra.to_date, rm.number
    into a
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_stay_a and ra.released_at is null
     and p_from >= ra.from_date and p_from < ra.to_date
   limit 1;

  select ra.id, ra.room_id, ra.from_date, ra.to_date, rm.number
    into b
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_stay_b and ra.released_at is null
     and p_from >= ra.from_date and p_from < ra.to_date
   limit 1;

  if a.id is null or b.id is null then
    raise exception 'both guests have to be in a room on that date'
      using hint = 'An exchange swaps two occupied rooms. To move one guest '
                   'into an empty room, use a room move.';
  end if;

  if a.room_id = b.room_id then
    raise exception 'those are the same room';
  end if;

  v_a_out := a.to_date;
  v_b_out := b.to_date;

  /* ---- both out, then both in -------------------------------------------
     The order is the whole function. Writing A into B's room while B still
     holds it violates the exclusion constraint, and no amount of care about
     WHICH is written first helps — one of them is always still there.

     Releasing both first empties the range for the swap. The nights already
     slept stay where they were slept: each old assignment is trimmed to end
     on p_from, exactly as a move does. */
  if a.from_date < p_from then
    update room_assignments set to_date = p_from where id = a.id;
  else
    update room_assignments set released_at = now() where id = a.id;
  end if;

  if b.from_date < p_from then
    update room_assignments set to_date = p_from where id = b.id;
  else
    update room_assignments set released_at = now() where id = b.id;
  end if;

  insert into room_assignments
    (hotel_id, reservation_id, room_id, from_date, to_date, reason, created_by)
  values
    (p_hotel, p_stay_a, b.room_id, p_from, v_a_out, 'move', p_by),
    (p_hotel, p_stay_b, a.room_id, p_from, v_b_out, 'move', p_by);

  return query select a.number, b.number,
    greatest(v_a_out - p_from, v_b_out - p_from)::int;
end $$;

comment on function app.exchange_rooms(uuid, uuid, uuid, date, text, uuid) is
  'Two guests trade rooms. Both assignments are released BEFORE either is '
  'written back — ra_no_double_booking is checked per statement, so two '
  'sequential moves can never work. One transaction: either both move or '
  'neither does.';

revoke all on function app.exchange_rooms(uuid, uuid, uuid, date, text, uuid)
  from public;
grant execute on function app.exchange_rooms(uuid, uuid, uuid, date, text, uuid)
  to pms_app;


-- -----------------------------------------------------------------------------
-- What the rate includes
-- -----------------------------------------------------------------------------
-- NO INCLUSION IS SHIPPED. A property that gives breakfast has somebody say
-- so, exactly as it enters its rooms and its prices. "Complimentary breakfast"
-- invented here would print on a folio at a hotel that does not serve any.
-- -----------------------------------------------------------------------------
create table if not exists inclusions (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  name         text not null,
  description  text,

  /* NULL means it costs nothing extra — which is what "included" means and is
     the common case. A number means the desk may add it and bill for it: the
     airport pickup is on the rate for a corporate booking and chargeable for
     a walk-in, and one row serves both. */
  default_rate numeric(12,2),

  /* Which folio line it becomes when it IS charged. `misc` unless the
     property says otherwise — a spa inclusion should read as spa on the bill
     so the revenue lands in the right column. */
  category     text not null default 'misc',

  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint inclusions_name_present check (length(trim(name)) > 0),
  constraint inclusions_rate_sane    check (default_rate is null
                                            or default_rate >= 0),
  constraint inclusions_category_known check
    (category in ('room','food','beverage','spa','laundry','minibar',
                  'telephone','misc')),
  constraint inclusions_name_unique unique (hotel_id, name)
);

comment on table inclusions is
  'What a rate can include — breakfast, an airport pickup, a welcome drink. '
  'None is shipped. default_rate NULL means included at no extra charge, '
  'which is what an inclusion usually is; a number means it may be billed.';


create table if not exists reservation_inclusions (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  inclusion_id   uuid references inclusions(id),

  /* Named here as well, because a booking often gets something off-list —
     "late checkout, agreed with the GM". A row with no inclusion_id and a
     name is a perfectly good promise. */
  name           text not null,
  quantity       int not null default 1,

  /* SNAPSHOTTED, like every other agreed number here. Repricing the airport
     pickup in March must not reprice a booking made in January. NULL means
     included at no charge. */
  rate           numeric(12,2),

  notes          text,
  added_by       uuid not null references staff(id),
  created_at     timestamptz not null default now(),

  constraint ri_name_present check (length(trim(name)) > 0),
  constraint ri_quantity_sane check (quantity > 0),
  constraint ri_rate_sane check (rate is null or rate >= 0)
);

comment on table reservation_inclusions is
  'What THIS booking was promised. A rate is not only a number — "3,400 with '
  'breakfast for two and the pickup" is one price and three promises, and a '
  'guest arriving at midnight asks about the promises.';

create index if not exists ri_reservation_idx
  on reservation_inclusions (reservation_id);


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table inclusions enable row level security;
alter table inclusions force  row level security;
drop policy if exists inclusions_isolation on inclusions;
create policy inclusions_isolation on inclusions
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table reservation_inclusions enable row level security;
alter table reservation_inclusions force  row level security;
drop policy if exists reservation_inclusions_isolation on reservation_inclusions;
create policy reservation_inclusions_isolation on reservation_inclusions
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists inclusions_touch on inclusions;
create trigger inclusions_touch before update on inclusions
  for each row execute function app.touch_updated_at();

grant select, insert, update on inclusions to pms_app;
grant select, insert, update, delete on reservation_inclusions to pms_app;
