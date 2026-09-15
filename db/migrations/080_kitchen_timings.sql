-- =============================================================================
-- 080 · When each dish moved — ordered, started, passed, served
-- =============================================================================
-- 079 gave the kitchen an ESTIMATE. This gives it the truth: what actually
-- happened to this dish, and when.
--
-- Four questions a restaurant runs on, and the system could answer none of
-- them:
--
--     ordered   -> sent        how long the waiter held it
--     sent      -> preparing   how long before the kitchen picked it up
--     preparing -> ready       how long it took to cook
--     ready     -> served      HOW LONG IT SAT UNDER THE LAMP
--
-- The last one is the one that ruins food, and it is invisible today.
-- `pos_order_lines` records `kot_sent_at` and then overwrites `kot_status`
-- three more times, keeping no time for any of them.
--
-- ⚠ A LEDGER, NOT FOUR COLUMNS, AND THE REASON IS THAT DISHES GO BACKWARDS.
--
-- The kitchen endpoint allows any move between preparing, ready and served —
-- deliberately, because a chef marks a dish ready, the waiter does not come,
-- and it goes back. With columns, that either overwrites the first time (and
-- the churn vanishes) or is refused (and the screen lies about the dish). With
-- rows, both facts survive: the dish was ready at 19:20, went back at 19:24,
-- and was ready again at 19:31.
--
-- It is APPEND-ONLY for the same reason `folio_postings` is. A timing somebody
-- can edit is a timing nobody can use in an argument, and "the pass sat on
-- this for twenty minutes" is exactly the kind of thing that gets argued
-- about.
--
-- ⚠ WRITTEN BY A TRIGGER, NOT BY THE ROUTES. Four different paths change
-- `kot_status` today — the KOT fire, the batch endpoint, the kitchen move, and
-- the void cascade — and a fifth will be added by somebody who has not read
-- this file. A route that forgets to record a timing is a gap nobody notices
-- until a report is wrong, which is the same shape as migration 075: the
-- database raises the event, so none of the callers can forget.
-- =============================================================================


create table if not exists pos_line_events (
  id        bigserial primary key,
  hotel_id  uuid   not null references hotels(id),
  line_id   bigint not null references pos_order_lines(id) on delete cascade,
  order_id  uuid   not null references pos_orders(id) on delete cascade,

  -- Where it moved TO. The previous state is the previous row.
  status    text   not null,

  at        timestamptz not null default now(),

  -- Who moved it. NULL only for something the system did on its own — the
  -- void cascade, or a script — and that is worth being able to tell apart
  -- from a person's act.
  by_staff  uuid   references staff(id),

  constraint pos_line_events_status_valid
    check (status in ('sent', 'preparing', 'ready', 'served'))
);

comment on table pos_line_events is
  'Every move a dish made through the kitchen, append-only. The timings a '
  'restaurant runs on are derived from here, never stored.';

create index if not exists pos_line_events_line_idx
  on pos_line_events (line_id, at);

create index if not exists pos_line_events_order_idx
  on pos_line_events (order_id);

-- Reporting reads this by property and day far more than by line.
create index if not exists pos_line_events_hotel_at_idx
  on pos_line_events (hotel_id, at);


-- -----------------------------------------------------------------------------
-- Append-only, and it is enforced rather than asked for
-- -----------------------------------------------------------------------------
create or replace function app.pos_line_events_append_only()
returns trigger
language plpgsql as $$
begin
  /* ⚠ A TIMING MAY GO WITH THE DISH IT DESCRIBES, AND ONLY THEN.
     By the time a cascade reaches here the parent line is already gone,
     which is how this tells "the dish was removed" from "somebody is
     erasing evidence of a slow pass".

     Written this way rather than blocking outright after the first
     version did: `delete from pos_orders` cascades to its lines and on
     to here, so every teardown in the suite and in api/test failed —
     and the fix of lifting a trigger in five places is five places to
     forget. The rule that survives is the narrower one, because it is
     the one that is actually true.

     Deleting the line itself is guarded separately, by
     `pos_order_lines_frozen`. */
  if tg_op = 'DELETE'
     and not exists (select 1 from pos_order_lines where id = old.line_id)
  then
    return old;
  end if;

  raise exception 'A kitchen timing cannot be % — it is a record of what '
                  'happened.', lower(tg_op)
    using hint = 'Move the dish again. The new move is a new row, and both '
                 'stay visible.',
          errcode = 'restrict_violation';
end $$;

drop trigger if exists pos_line_events_no_update on pos_line_events;
create trigger pos_line_events_no_update
  before update on pos_line_events
  for each row execute function app.pos_line_events_append_only();

drop trigger if exists pos_line_events_no_delete on pos_line_events;
create trigger pos_line_events_no_delete
  before delete on pos_line_events
  for each row execute function app.pos_line_events_append_only();


-- -----------------------------------------------------------------------------
-- The recorder
-- -----------------------------------------------------------------------------
-- Fires on every kot_status change, including the first move out of 'pending'
-- when the KOT is sent. No route writes to this table directly and none
-- should.
create or replace function app.pos_line_timing()
returns trigger
language plpgsql as $$
begin
  -- Only real movement. An UPDATE that touches the price does not make a
  -- timing, and a status set to what it already was is not a move.
  if new.kot_status is not distinct from old.kot_status then
    return new;
  end if;

  -- 'pending' is not a kitchen state, it is the absence of one. A dish
  -- returning to pending has been un-sent, and that is a void, recorded
  -- elsewhere.
  if new.kot_status = 'pending' then
    return new;
  end if;

  insert into pos_line_events (hotel_id, line_id, order_id, status, by_staff)
  values (new.hotel_id, new.id, new.order_id, new.kot_status,
          app.current_user_id());

  return new;
end $$;

drop trigger if exists pos_order_lines_timing on pos_order_lines;
create trigger pos_order_lines_timing
  after update of kot_status on pos_order_lines
  for each row execute function app.pos_line_timing();

comment on function app.pos_line_timing() is
  'Records every kitchen move as its own row. On the table rather than in the '
  'routes, because four paths change kot_status today and the fifth will be '
  'written by somebody who has not read migration 080.';


-- -----------------------------------------------------------------------------
-- What actually happened to one dish
-- -----------------------------------------------------------------------------
-- ⚠ THE LAST TIME IT ENTERED EACH STATE, not the first.
--
-- A dish marked ready at 19:20, sent back at 19:24 and ready again at 19:31
-- was READY at 19:31 — that is when the state became true and stayed true, and
-- it is what the guest experienced. The earlier claim is still in the table
-- for anybody asking why a dish bounced, which is a different question and
-- deserves a different query.
--
-- Every column is nullable and that is the point: a dish still cooking has no
-- served time, and NULL means "has not happened yet", never zero minutes.
create or replace function app.pos_line_timings(p_line bigint)
returns table (
  ordered_at    timestamptz,
  sent_at       timestamptz,
  started_at    timestamptz,
  ready_at      timestamptz,
  served_at     timestamptz,
  -- Minutes, derived, and null wherever either end is missing.
  to_start_min  numeric,
  to_cook_min   numeric,
  at_pass_min   numeric,
  total_min     numeric
)
language sql
stable
as $$
  with e as (
    select max(at) filter (where status = 'sent')      as sent,
           max(at) filter (where status = 'preparing') as started,
           max(at) filter (where status = 'ready')     as ready,
           max(at) filter (where status = 'served')    as served
      from pos_line_events where line_id = p_line
  ),
  l as (select added_at from pos_order_lines where id = p_line)
  select l.added_at, e.sent, e.started, e.ready, e.served,
         round(extract(epoch from (e.started - e.sent))    / 60.0, 1),
         round(extract(epoch from (e.ready   - e.started)) / 60.0, 1),
         -- THE ONE THAT RUINS FOOD.
         round(extract(epoch from (e.served  - e.ready))   / 60.0, 1),
         round(extract(epoch from (e.served  - l.added_at))/ 60.0, 1)
    from l cross join e
$$;

comment on function app.pos_line_timings(bigint) is
  'When one dish moved, and how long each stage took. NULL means it has not '
  'happened yet — never zero. Uses the LAST entry into each state, because a '
  'dish sent back to the kitchen was ready when it was ready the second time.';

grant execute on function app.pos_line_timings(bigint) to pms_app;


-- -----------------------------------------------------------------------------
-- Whether it beat its estimate
-- -----------------------------------------------------------------------------
-- 079 says how long a dish SHOULD take. This says whether it did. Positive is
-- late; negative is early.
--
-- NULL when either half is missing, and both halves go missing routinely: an
-- untimed dish has no estimate, and a dish still cooking has no actual. A zero
-- here would read as "exactly on time", which is a claim.
create or replace function app.pos_line_lateness(p_line bigint)
returns numeric
language sql
stable
as $$
  select case
           when t.started_at is null or t.ready_at is null then null
           when app.prep_minutes(l.item_id) is null then null
           else round(
             extract(epoch from (t.ready_at - t.started_at)) / 60.0
             - app.prep_minutes(l.item_id), 1)
         end
    from pos_order_lines l
    cross join lateral app.pos_line_timings(l.id) t
   where l.id = p_line
$$;

comment on function app.pos_line_lateness(bigint) is
  'Minutes over the estimate from 079: positive late, negative early. NULL '
  'when the dish is untimed or has not been cooked yet — never zero, which '
  'would read as "exactly on time".';

grant execute on function app.pos_line_lateness(bigint) to pms_app;


-- -----------------------------------------------------------------------------
-- Row level security, the same shape as every other POS table
-- -----------------------------------------------------------------------------
alter table pos_line_events enable row level security;
alter table pos_line_events force row level security;

-- ⚠ `app.auth_hotel_ids()`, AND THE SAME POLICY NAME AS EVERY OTHER TABLE.
-- The first version of this file spelled the predicate by hand as
-- `hotel_id in (select hotel_id from staff_hotels where staff_id = ...)`,
-- which looks equivalent and is not: nine API tests failed with 500 because
-- that hand-rolled version does not answer for a group admin the way
-- `auth_hotel_ids` does. Isolation is written once, in that function, and
-- every table asks it the same question.
drop policy if exists pos_line_events_rls on pos_line_events;
drop policy if exists hotel_isolation on pos_line_events;
create policy hotel_isolation on pos_line_events
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

grant select, insert on pos_line_events to pms_app;
grant usage, select on sequence pos_line_events_id_seq to pms_app;
