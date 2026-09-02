-- =============================================================================
-- 046 — "we are out of paneer", and "we are closed"
-- =============================================================================
-- 045 gave items and add-ons an `off_until`. This gives the OUTLET the same
-- thing, and puts the reading of those timestamps in one place.
--
-- WHY A TIMESTAMP AND NOT A FLAG. A boolean has to be unset by somebody
-- remembering, at the end of a shift they are already behind on. The dish
-- stays off the menu for a week and nobody can say since when. A time answers
-- both questions — is it off, and when does it come back — and answers the
-- second one to the guest at the table, which a flag never could.
--
-- THE FIVE STATES ON THE SCREEN ARE READINGS OF ONE COLUMN:
--
--   on            off_until is null, or in the past
--   off           off_until is in the future
--   queued        off_until is in the future AND more than a day out —
--                 somebody has taken it off for longer than a shift
--   unscheduled   the item is inactive entirely; not a shift decision
--   partial       an item whose ADD-ONS are not all in the same state
--
-- Four columns would have let those disagree. One column cannot.
-- =============================================================================

alter table pos_outlets
  add column if not exists closed_until  timestamptz,
  add column if not exists closed_reason text;

comment on column pos_outlets.closed_until is
  'The whole outlet is shut until this moment — the "Store On/Off" switch. '
  'The till refuses a new order and says when it reopens.';


-- -----------------------------------------------------------------------------
-- Is it available right now?
-- -----------------------------------------------------------------------------
-- One definition, so the menu screen, the till and the outside bridge cannot
-- disagree about whether a dish can be sold. `now()` and not the business
-- date: a kitchen running out of paneer at 21:40 means paneer is off NOW,
-- and the hotel's operating day is a different question entirely.
-- -----------------------------------------------------------------------------
create or replace function app.is_available(p_off_until timestamptz)
returns boolean language sql immutable as $$
  select p_off_until is null or p_off_until <= now()
$$;

comment on function app.is_available(timestamptz) is
  'True when nothing is holding this off. Reads the one timestamp that the '
  'menu screen, the till and the bridge all consult, so none of them can '
  'believe a different thing about the same dish.';

grant execute on function app.is_available(timestamptz) to pms_app;
