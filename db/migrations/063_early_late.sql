-- =============================================================================
-- 063 — arriving early, leaving late
-- =============================================================================
-- Every property here sells the night from its check-in time to its check-out
-- time — 14:00 to 11:00 at all three today. A guest who wants the room at nine
-- in the morning is asking for most of another night, and a guest still in it
-- at four in the afternoon has had one.
--
-- Until now the system had no opinion about the CLOCK at all. `canCheckIn`
-- checks the DATE and stops there, so a guest could be checked in at 06:00 with
-- nothing recorded, nothing charged and nobody's name against the decision.
--
-- THE ASYMMETRY IS DELIBERATE, and it is how the front desk actually works:
--
--   arriving AFTER the check-in time     normal. Nothing to record.
--   arriving BEFORE it                   somebody has to say why, and say yes.
--   leaving BEFORE the check-out time    normal. Nothing to record.
--   leaving AFTER it                     somebody has to say why, and say yes.
--
-- WHAT "APPROVAL" MEANS HERE. Not a second person and a queue — this is a desk
-- with one terminal, and a workflow that waits for a manager to log in is a
-- workflow that gets bypassed. It means the act is ATTRIBUTED: who allowed it,
-- when, and on what grounds. That is the same answer `banquet_events.
-- registered_by` and `work_orders.raised_by` give, and it is the one that
-- survives somebody asking in three months why room 204 was free until noon.
--
-- NO CHARGE IS SHIPPED. `early_checkin_charge` and `late_checkout_charge` are
-- NULL until somebody at the property types a number, exactly like every other
-- price in this schema. NULL means "we do not charge for this", which is a
-- real and common answer — plenty of hotels give an early arrival away when
-- the room is free anyway. It does NOT mean zero, and the difference shows: a
-- property that has not decided sees a dash, not ₹0.
-- =============================================================================

alter table hotels add column if not exists early_checkin_charge  numeric(12,2);
alter table hotels add column if not exists late_checkout_charge  numeric(12,2);

alter table hotels drop constraint if exists hotels_early_late_sane;
alter table hotels add constraint hotels_early_late_sane check (
  (early_checkin_charge is null or early_checkin_charge >= 0)
  and (late_checkout_charge is null or late_checkout_charge >= 0)
);

comment on column hotels.early_checkin_charge is
  'What an early arrival costs. NULL means the property does not charge for '
  'one, which is a real answer and not the same as zero — the screens show a '
  'dash so nobody mistakes "not decided" for "free".';

comment on column hotels.late_checkout_charge is
  'What a late departure costs. NULL means the property does not charge.';


-- -----------------------------------------------------------------------------
-- What was allowed, by whom, and why
-- -----------------------------------------------------------------------------
alter table reservations add column if not exists early_checkin_at     timestamptz;
alter table reservations add column if not exists early_checkin_reason text;
alter table reservations add column if not exists early_checkin_by     uuid references staff(id);

alter table reservations add column if not exists late_checkout_at     timestamptz;
alter table reservations add column if not exists late_checkout_reason text;
alter table reservations add column if not exists late_checkout_by     uuid references staff(id);

/* A REASON IS NOT OPTIONAL ONCE THE EXCEPTION IS MADE. The whole value of
   recording an early arrival is the sentence beside it — "flight landed at
   05:40", "room was vacant and clean", "regular, always early". A row saying
   only that it happened answers nothing anybody will actually ask.

   Both halves or neither: the timestamp without a reason is the state this
   constraint exists to make impossible. */
alter table reservations drop constraint if exists reservations_early_has_reason;
alter table reservations add constraint reservations_early_has_reason check (
  early_checkin_at is null
  or (length(trim(coalesce(early_checkin_reason, ''))) > 0
      and early_checkin_by is not null)
);

alter table reservations drop constraint if exists reservations_late_has_reason;
alter table reservations add constraint reservations_late_has_reason check (
  late_checkout_at is null
  or (length(trim(coalesce(late_checkout_reason, ''))) > 0
      and late_checkout_by is not null)
);

comment on column reservations.early_checkin_reason is
  'Why the room was given early. The sentence somebody reads in three months '
  'when they ask why 204 was occupied from nine in the morning.';


-- -----------------------------------------------------------------------------
-- Is this early, or late?
-- -----------------------------------------------------------------------------
-- ONE DEFINITION. The check-in screen, the check-out screen and the API all
-- ask the same question the same way — a rule written in three places is wrong
-- in one, and here "wrong" means a charge that appears on one screen and not
-- on the folio.
--
-- The property's OWN clock. A hotel in Akkalkot closes its day in
-- Asia/Kolkata, and comparing a UTC timestamp against a local 14:00 is how a
-- guest arriving at 14:30 gets billed for an early arrival.
-- -----------------------------------------------------------------------------
drop function if exists app.arrival_is_early(uuid, timestamptz);
create function app.arrival_is_early(p_hotel uuid, p_at timestamptz)
returns boolean language sql stable as $$
  select (p_at at time zone h.timezone)::time < h.check_in_time
    from hotels h where h.id = p_hotel;
$$;

drop function if exists app.departure_is_late(uuid, timestamptz);
create function app.departure_is_late(p_hotel uuid, p_at timestamptz)
returns boolean language sql stable as $$
  select (p_at at time zone h.timezone)::time > h.check_out_time
    from hotels h where h.id = p_hotel;
$$;

comment on function app.arrival_is_early(uuid, timestamptz) is
  'True when the guest is arriving before the property lets rooms go. Compared '
  'in the PROPERTY''S timezone — against a UTC clock, a guest arriving at 14:30 '
  'in Akkalkot reads as 09:00 and is billed for an early arrival.';

grant execute on function app.arrival_is_early(uuid, timestamptz)   to pms_app;
grant execute on function app.departure_is_late(uuid, timestamptz)  to pms_app;
