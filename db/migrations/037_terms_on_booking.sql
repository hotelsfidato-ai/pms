-- =============================================================================
-- 037_terms_on_booking.sql — the terms reach the booking
-- =============================================================================
-- 036 gave a property somewhere to write its terms and taught the night audit
-- to charge what the BOOKING says. Nothing put anything on a booking, so
-- `app.retention_for` returned null for every reservation in existence and the
-- audit went on charging nothing. The feature could not fire.
--
-- This is the missing half.
--
-- A PROPERTY-CHOSEN DEFAULT IS NOT A SHIPPED DEFAULT
--
-- The rule against defaults is that the SYSTEM must not invent figures nobody
-- at the hotel agreed to — the room rates that arrived at 4099, the retention
-- that would arrive at "one night, 24 hours". A property marking one of its
-- own written policies as the one that applies to new bookings is the opposite
-- of that: it is the hotel stating its terms. Ships false on every policy, so
-- a property that marks none carries on exactly as before.
--
-- WHY A TRIGGER AND NOT THE BOOKING SCREENS
--
-- Bookings are made from the walk-in flow, the reservation flow, the demo
-- loader, and will be made by the channel manager when Stage 11 lands. Terms
-- attached in four places are terms missing from the fifth.
-- =============================================================================


alter table cancellation_policies
  add column if not exists applies_to_new_bookings boolean not null default false;

comment on column cancellation_policies.applies_to_new_bookings is
  'The policy this property puts on a booking when none is named. False on '
  'every policy until somebody at the hotel says otherwise.';

-- At most one per property. Two policies both claiming new bookings is a
-- silent coin-toss over what a guest agreed to.
create unique index if not exists cancellation_policies_one_default
  on cancellation_policies (hotel_id)
  where applies_to_new_bookings and is_active;


-- -----------------------------------------------------------------------------
-- Freeze the terms onto the row
-- -----------------------------------------------------------------------------
-- Copied, not referenced — the reason 005 gives for `agreed_rate` being a
-- column: "if a rate plan changes in June, a booking made in March must not
-- silently change with it". Terms are the same kind of fact.
--
-- Only ever fills a booking that has none. A caller that names a policy, or
-- writes its own figures, is left alone: this is a fallback, not an override.
-- -----------------------------------------------------------------------------
create or replace function app.freeze_cancellation_terms()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p record;
begin
  -- Already carries terms. Nothing to do, and nothing to overwrite.
  if new.cancel_basis is not null or new.cancellation_policy_id is not null then
    return new;
  end if;

  select id, name, free_until_hours,
         cancel_basis, cancel_percent, cancel_amount,
         no_show_basis, no_show_percent, no_show_amount
    into p
    from cancellation_policies
   where hotel_id = new.hotel_id
     and applies_to_new_bookings
     and is_active;

  -- No policy marked. The booking carries no terms, `app.retention_for`
  -- returns null for it, and the audit charges nothing — which is correct,
  -- because nobody agreed to anything.
  if not found then
    return new;
  end if;

  new.cancellation_policy_id  := p.id;
  new.cancel_terms            := p.name;
  new.cancel_free_until_hours := p.free_until_hours;
  new.cancel_basis            := p.cancel_basis;
  new.cancel_percent          := p.cancel_percent;
  new.cancel_amount           := p.cancel_amount;
  new.no_show_basis           := p.no_show_basis;
  new.no_show_percent         := p.no_show_percent;
  new.no_show_amount          := p.no_show_amount;

  return new;
end $$;

-- SECURITY DEFINER because the policy lives behind RLS and the booking may be
-- made by a clerk whose session can read it perfectly well — but the function
-- must not depend on that being true for every future caller. It reads one row
-- of the booking's OWN hotel and writes nothing outside `new`.
drop trigger if exists reservations_freeze_terms on reservations;
create trigger reservations_freeze_terms
  before insert on reservations
  for each row execute function app.freeze_cancellation_terms();

comment on function app.freeze_cancellation_terms() is
  'Copies the property-chosen policy onto a new booking. A fallback, never an '
  'override: a booking that already names terms is left exactly as given.';
