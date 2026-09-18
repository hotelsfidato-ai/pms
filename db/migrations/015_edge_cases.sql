-- =============================================================================
-- 015_edge_cases.sql — the four breaks found by probing live data
-- =============================================================================
-- Every change here is ADDITIVE and guarded. Nothing in 001–014 is rewritten,
-- because 27 assertions currently depend on that behaviour and the point of
-- this file is to add refusals, not to alter existing ones.
--
-- Run db/tests/run.sh before and after. Same 27 must still pass.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- B1 — day-use rooms were impossible.
-- -----------------------------------------------------------------------------
-- `check_out > check_in` forbids a same-day stay outright. Indian city hotels
-- sell day-use rooms routinely: airport transits, meeting bookings, early
-- arrivals. The schema could not represent one at all.
--
-- Relaxing to >= admits them. The generated column then lets night audit and
-- the rate engine tell a day-use stay from an overnight one without inspecting
-- dates everywhere.
-- -----------------------------------------------------------------------------
alter table reservations drop constraint if exists reservations_dates_ordered;
alter table reservations
  add constraint reservations_dates_ordered check (check_out >= check_in);

alter table reservations
  add column if not exists is_day_use boolean
  generated always as (check_out = check_in) stored;

-- A day-use assignment needs a range the exclusion constraint can hold, so
-- from_date = to_date is now legal there too. Two day-use guests in the same
-- room on the same day remain impossible — an empty range cannot overlap, so
-- the guard is a partial unique index rather than the gist exclusion.
alter table room_assignments drop constraint if exists ra_dates_ordered;
alter table room_assignments
  add constraint ra_dates_ordered check (to_date >= from_date);

create unique index if not exists ra_day_use_unique
  on room_assignments (room_id, from_date)
  where released_at is null and from_date = to_date;


-- -----------------------------------------------------------------------------
-- B2 — an assignment could sit outside the booking it belonged to.
-- -----------------------------------------------------------------------------
-- An assignment for 2028-01-01→05 was accepted against a reservation for
-- 2027-01-01→05. Nothing tied them together, so a clerk could block a room for
-- dates the guest was never booked — and it would appear on no arrivals list,
-- no departure list and no occupancy report, while making the room unsellable.
-- -----------------------------------------------------------------------------
create or replace function app.assert_assignment_within_stay()
returns trigger
language plpgsql
as $$
declare v_in date; v_out date;
begin
  select check_in, check_out into v_in, v_out
    from reservations where id = new.reservation_id;

  if v_in is null then
    raise exception 'Reservation % does not exist', new.reservation_id;
  end if;

  if new.from_date < v_in or new.to_date > v_out then
    raise exception
      'Room assignment %..% falls outside the booking %..%',
      new.from_date, new.to_date, v_in, v_out
      using hint = 'Extend the reservation first, or correct the assignment dates.';
  end if;

  return new;
end $$;

drop trigger if exists ra_within_stay on room_assignments;
create trigger ra_within_stay
  before insert or update on room_assignments
  for each row execute function app.assert_assignment_within_stay();


-- -----------------------------------------------------------------------------
-- B3 — tax_amount was unrelated to tax_rate.
-- -----------------------------------------------------------------------------
-- 1,000 posted at 12% with tax_amount = 9999 was ACCEPTED. The columns are
-- independent, so a GST invoice could print a tax figure that does not follow
-- from its own rate — a statutory document carrying arithmetic the database
-- was happy to store.
--
-- One paisa of tolerance, because rounding at the line level is legitimate and
-- exact equality would reject honest half-paisa cases.
-- -----------------------------------------------------------------------------
alter table folio_postings drop constraint if exists fp_tax_consistent;
alter table folio_postings
  add constraint fp_tax_consistent check (
    abs(tax_amount - round(amount * tax_rate / 100.0, 2)) <= 0.01
  );


-- -----------------------------------------------------------------------------
-- B4 — zero-value postings, and bookings in the distant past.
-- -----------------------------------------------------------------------------
-- A posting that moves no money is a no-op cluttering every folio and every
-- revenue report. A reservation dated 2019 went in without complaint, which is
-- almost always a typo or an import fault rather than an intention.
--
-- The floor is deliberately a fixed date rather than `>= current_date`: back-
-- dating a genuine walk-in by a day is normal, and a rolling guard would make
-- the table's own history invalid the moment it aged.
-- -----------------------------------------------------------------------------
alter table folio_postings drop constraint if exists fp_nonzero;
alter table folio_postings
  add constraint fp_nonzero check (amount <> 0);

alter table reservations drop constraint if exists reservations_not_ancient;
alter table reservations
  add constraint reservations_not_ancient check (check_in >= date '2020-01-01');


-- -----------------------------------------------------------------------------
-- The one that passed for the wrong reason — deleting a property.
-- -----------------------------------------------------------------------------
-- `hotels` cascades into rooms → reservations → folios → folio_postings, and
-- the delete only failed because the append-only trigger refused the ledger
-- rows. A property with NO postings yet would have deleted cleanly, taking its
-- rooms and bookings with it.
--
-- The protection was incidental. Make it deliberate, at the top of the chain.
-- -----------------------------------------------------------------------------
create or replace function app.forbid_hotel_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A property is deactivated, never deleted.'
    using hint = 'update hotels set is_active = false where id = ...';
end $$;

drop trigger if exists hotels_no_delete on hotels;
create trigger hotels_no_delete
  before delete on hotels
  for each row execute function app.forbid_hotel_delete();

-- Same reasoning for guests: constraint 17 says deactivate, never delete, and
-- deleting one would orphan every audit row that names them.
create or replace function app.forbid_guest_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'A guest is never deleted - stay history and the audit trail depend on the row.'
    using hint = 'Anonymise the identity documents instead, per the retention policy.';
end $$;

drop trigger if exists guests_no_delete on guests;
create trigger guests_no_delete
  before delete on guests
  for each row execute function app.forbid_guest_delete();


insert into schema_migrations (version) values ('015_edge_cases')
on conflict (version) do nothing;
