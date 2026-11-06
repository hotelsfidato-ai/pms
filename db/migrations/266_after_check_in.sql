-- =============================================================================
-- 266 · After check-in: the GM undoes, cancels, voids and changes; the front
--       desk asks (the owner's D27-397, 6 November)
-- =============================================================================
-- The owner: "After the check-in ... we can't cancel the booking or settle
-- out ... we need an option where the GM doesn't have the lock, which is there
-- for the reception and the front desk, but not for the GM. It's an option in
-- the settings." And: "Remove the restriction on change and void for GM. But
-- it needs to be there for front desk. If the front desk needs to do, they
-- need to get approval ... from the GM."
--
--   1 hotels.gm_may_undo_check_in   Front desk rules: "The GM may undo a
--                                   check-in". On at every hotel, existing ones
--                                   included (the owner's answer 3).
--   2 stay_requests                 the front desk SENDS the GM what it may not
--                                   do after check-in - undo the check-in,
--                                   cancel, void, the arrival date, the rate,
--                                   how a payment was taken - with a reason; an
--                                   approval of kind 'stay_request' in the GM's
--                                   inbox and bell. Approving DOES it, as the
--                                   approver, with every check (the restaurant's
--                                   way, 237). One of a kind per stay waiting.
--   3 a rule for every hotel        the GM decides; the owner and an Admin too.
--   4 app.amend_stay                an in-house guest's arrival moves, for the
--                                   owner, an Admin or the GM, while no Night
--                                   audit has charged a night of the stay: no
--                                   later than the business date, and never
--                                   into a closed day. Every refusal of 176
--                                   kept; the old lock stays for everybody else.
--
-- THE LISTS OTHER MIGRATIONS ALSO GROW (the kinds an approval may be, a test
-- hotel's classes, a property's columns) are added to IN PLACE, from what the
-- database holds now, not rewritten from a copy: several helpers add to them
-- at once (D27-396), and a copy of this week's list would drop another's line.
--
-- Re-runnable.
-- =============================================================================

-- ── 1 · The switch ───────────────────────────────────────────────────────────
alter table hotels add column if not exists gm_may_undo_check_in boolean not null default true;
comment on column hotels.gm_may_undo_check_in is
  'Front desk rules (D27-397): the GM may undo a check-in, and cancel or void a guest in house; the '
  'front desk may ask the GM to. Off: the old lock for both. The owner and an Admin always may.';

-- A test hotel copies it, as it copies the other front desk rules (212).
do $$
declare d text := pg_get_functiondef('app.test_hotel_hotels_columns()'::regprocedure);
begin
  if position('gm_may_undo_check_in' in d) = 0 then
    execute replace(d, $q$('id', false)$q$, $q$('gm_may_undo_check_in', true), ('id', false)$q$);
  end if;
end $$;

-- ── 2 · The front desk's request to the GM ───────────────────────────────────
create table if not exists stay_requests (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  kind          text not null check (kind in
                  ('undo_check_in', 'cancel', 'void', 'arrival', 'rate', 'payment_method')),
  -- What exactly: the new arrival, the new rate, the payment and its new way.
  details       jsonb not null default '{}',
  -- What the GM reads: "Undo the check-in - Asha Rao, room 101, FH-2611-0004".
  summary       text not null,
  reason        text not null check (length(btrim(reason)) between 1 and 300),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approval_id   uuid references approvals(id) on delete cascade,
  requested_by  uuid not null references staff(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text,
  constraint stay_requests_not_own check (decided_by is null or decided_by <> requested_by)
);
-- One of a kind per stay waiting at a time (D27-397 point 4).
create unique index if not exists stay_requests_one_waiting
  on stay_requests (reservation_id, kind) where status = 'pending';
create index if not exists stay_requests_pending on stay_requests (hotel_id) where status = 'pending';
comment on table stay_requests is
  'The front desk''s request to the GM after check-in (D27-397): undo the check-in, cancel, void, '
  'the arrival date, the rate, how a payment was taken. Approved in the Approvals inbox, which does it.';

alter table stay_requests enable row level security;
alter table stay_requests force row level security;
drop policy if exists hotel_isolation on stay_requests;
create policy hotel_isolation on stay_requests
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update on stay_requests to pms_app;
revoke delete on stay_requests from pms_app;

-- A test hotel's trade, as the restaurant's requests are (237).
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('stay_requests' in d) = 0 then
    execute replace(d, $q$('pos_requests', 'trading')$q$,
                       $q$('pos_requests', 'trading'), ('stay_requests', 'trading')$q$);
  end if;
end $$;

-- ── 3 · The approvals inbox learns the kind; a rule for every hotel ──────────
do $$
declare
  t text;
  d text;
begin
  foreach t in array array['approval_rules', 'approvals'] loop
    select pg_get_constraintdef(oid) into d from pg_constraint
     where conrelid = t::regclass and conname = t || '_kind_known';
    if d is not null and position('stay_request' in d) = 0 then
      execute format('alter table %I drop constraint %I', t, t || '_kind_known');
      execute format('alter table %I add constraint %I %s', t, t || '_kind_known',
                     replace(d, 'ARRAY[', 'ARRAY[''stay_request''::text, '));
    end if;
  end loop;
end $$;

-- The GM decides; the owner and an Admin too (D27-397, as the POS rule).
insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'stay_request', 'gm', null, array['owner', 'admin']
  from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

create or replace function app.stay_request_rule_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'stay_request', 'gm', null, array['owner', 'admin'])
  on conflict (hotel_id, kind, approver_role) do nothing;
  return new;
end $fn$;
revoke all on function app.stay_request_rule_for_new_property() from public;

drop trigger if exists hotels_stay_request_rule on hotels;
create trigger hotels_stay_request_rule
  after insert on hotels
  for each row execute function app.stay_request_rule_for_new_property();

-- ── 4 · An in-house guest's arrival (176's function, one rule changed) ───────
create or replace function app.amend_stay(
  p_hotel       uuid,
  p_reservation uuid,
  p_check_in    date,
  p_check_out   date,
  p_adults      smallint,
  p_children    smallint,
  p_by          uuid
)
returns table (
  nights_before int,
  nights_after  int,
  room_held     text        -- the room whose hold was resized, or NULL
)
language plpgsql
as $$
declare
  r          record;
  a          record;
  v_last_posted date;
  v_closed   date;
  v_max_occ  int;
  v_room     text := null;
begin
  select res.*, rt.max_occupancy into r
    from reservations res
    join room_types rt on rt.id = res.room_type_id
   where res.id = p_reservation and res.hotel_id = p_hotel;

  if r.id is null then
    raise exception 'no such reservation here';
  end if;

  if r.status not in ('confirmed', 'checked_in') then
    raise exception 'this booking is %, so there is nothing to amend', r.status
      using hint = 'A booking that has left or been cancelled is history.';
  end if;

  /* A DAY USE ends the day it starts (D27-227): only a departure BEFORE the
     arrival is refused. */
  if p_check_out < p_check_in then
    raise exception 'a stay ends after it starts'
      using hint = 'The night of departure is not charged, so a guest leaving '
                   'on the 5th has their last night on the 4th.';
  end if;

  -- ---- 3 · they have already arrived ----------------------------------
  /* D27-397: the owner, an Admin or the GM - the three who correct a closed
     day (app.corrects_closed_days) - may move it; for everybody else the
     arrival is a fact, as before. */
  if r.status = 'checked_in' and p_check_in <> r.check_in then
    if not app.corrects_closed_days(p_hotel) then
      raise exception 'they arrived on %, and that cannot move', r.check_in
        using hint = 'Change the departure instead, or ask the GM to change the arrival date.';
    end if;
    if p_check_in > app.business_date(p_hotel) then
      raise exception 'a guest in house cannot arrive later than the business date, %', app.business_date(p_hotel)
        using hint = 'An arrival in house is never after today.';
    end if;
    if exists (select 1 from folio_postings fp
                where fp.reservation_id = p_reservation and fp.category = 'room'
                  and fp.source_type = 'night_audit' and fp.reverses_id is null
                  and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)) then
      raise exception 'a Night audit has charged a night of this stay, so its arrival no longer moves'
        using hint = 'Correct the charged night on Closed days instead.';
    end if;
    /* A night added before the old arrival, or the new arrival itself, on a
       day a Night audit has closed would be a night never charged. */
    select min(na.business_date) into v_closed
      from night_audit_runs na
     where na.hotel_id = p_hotel and na.status = 'completed'
       and na.business_date >= p_check_in
       and na.business_date < greatest(r.check_in, p_check_in + 1);
    if v_closed is not null then
      raise exception 'the night of % is closed by a Night audit, so the stay cannot start before it', v_closed
        using hint = 'It would be a night that was never charged. Use Correct a closed day instead.';
    end if;
  end if;

  -- ---- occupancy -------------------------------------------------------
  v_max_occ := r.max_occupancy;
  if p_adults < 1 then
    raise exception 'a stay has at least one adult';
  end if;
  if p_adults + p_children > v_max_occ then
    raise exception '% people will not fit a % - it sleeps %',
      p_adults + p_children, (select name from room_types where id = r.room_type_id),
      v_max_occ
      using hint = 'Move them to a larger room type, or split across two rooms.';
  end if;

  -- ---- 2 · nights already charged --------------------------------------
  /* A LIVE room charge. There is no `reversed` flag — a reversal is its own
     row pointing back with `reverses_id`, because the ledger is append-only
     and a posting is never edited. So a charge still stands only if it is not
     itself a reversal and nothing has reversed it. */
  select max(fp.business_date) into v_last_posted
    from folio_postings fp
    join folios f on f.id = fp.folio_id
   where f.reservation_id = p_reservation
     and fp.category = 'room'
     and fp.reverses_id is null
     and not exists (
       select 1 from folio_postings x where x.reverses_id = fp.id);

  if v_last_posted is not null then
    /* A room charge dated D pays for the night of D, so the stay must still
       cover D — that is, check_out must be after it. */
    /* A day use's own day, charged at its check-in (D27-225), is inside it. */
    if p_check_out <= v_last_posted
       and not (p_check_out = p_check_in and v_last_posted = p_check_in) then
      raise exception 'the night of % has already been charged', v_last_posted
        using hint = 'Reverse that posting first if the guest is not staying '
                     'it, so the folio says why rather than simply losing a '
                     'night.';
    end if;
    if p_check_in > v_last_posted then
      raise exception 'the night of % has already been charged', v_last_posted
        using hint = 'Moving arrival past a charged night would leave a room '
                     'charge outside the stay.';
    end if;
  end if;

  -- ---- the booking moves FIRST ------------------------------------------
  /* Order matters, and not for style. A trigger keeps every assignment inside
     its reservation's dates, so resizing the hold before the booking raises
     "assignment 10th..16th falls outside the booking 10th..14th" — refusing
     the very thing being asked for. The booking moves, then the hold follows.

     If the hold then collides, the whole function rolls back: the caller made
     one statement, so a refused extension leaves the booking exactly as it
     was. */
  update reservations
     set check_in  = p_check_in,
         check_out = p_check_out,
         adults    = p_adults,
         children  = p_children
   where id = p_reservation;

  -- ---- 1 · and the room hold follows it ---------------------------------
  select ra.id, rm.number into a
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
     and ra.released_at is null
   order by ra.from_date
   limit 1;

  if a.id is not null then
    v_room := a.number;
    /* Resized rather than left behind. The exclusion constraint refuses this
       if the room is taken for the nights being added, which is the whole
       point — the alternative is a booking that claims six nights while the
       room is held for four. A guest in house holds their room from the new
       arrival, earlier or later (D27-397). */
    update room_assignments
       set from_date = case when r.status = 'checked_in' and from_date = r.check_in then p_check_in
                            else greatest(p_check_in, least(from_date, p_check_out - 1)) end,
           to_date   = p_check_out
     where id = a.id;

    /* Any LATER assignment — the stay has been moved before — is clipped to
       the new departure too, and dropped if it now starts after it. */
    update room_assignments
       set to_date = p_check_out
     where reservation_id = p_reservation
       and released_at is null
       and to_date > p_check_out
       and from_date < p_check_out;

    update room_assignments
       set released_at = now()
     where reservation_id = p_reservation
       and released_at is null
       and from_date >= p_check_out
       -- A day use's hold starts and ends on its day (015): it stays.
       and from_date > p_check_in;
  end if;

  nights_before := (r.check_out - r.check_in)::int;
  nights_after  := (p_check_out - p_check_in)::int;
  room_held     := v_room;

  return next;
end $$;

comment on function app.amend_stay is
  'Changes a booking''s dates and party size, resizing the room hold with it; '
  'a day use (out the day it comes) is a stay too (176). '
  'Refuses a departure before a night already charged, a party larger than the room type sleeps, '
  'and a moved arrival on a guest who has arrived - except for the owner, an Admin or the GM (266, '
  'D27-397): no later than the business date, never into a closed day, and not once a Night audit '
  'has charged a night of the stay. Does not touch agreed_rate.';

revoke all on function app.amend_stay(uuid, uuid, date, date, smallint, smallint, uuid)
  from public;
grant execute on function app.amend_stay(uuid, uuid, date, date, smallint, smallint, uuid)
  to pms_app;
