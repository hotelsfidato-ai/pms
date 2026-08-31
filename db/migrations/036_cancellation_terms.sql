-- =============================================================================
-- 036_cancellation_terms.sql — what a cancellation or a no-show costs
-- =============================================================================
-- The night audit marks an arrival that never came as `no_show` and charges
-- nothing. That was the right call while this was unmodelled: whether a no-show
-- is billed depends on terms the guest agreed to, and a guessed charge is worse
-- than none — nothing missing is visible, a wrong number is not.
--
-- This models the terms, so the audit can stop guessing by charging zero.
--
-- NO DEFAULTS, THE SAME RULE AS PRICES
--
-- Ships with no policy and no figures. A hotel that has not written its terms
-- down has no terms, and the audit charges nothing — exactly what it does
-- today. Inventing "one night, 24 hours" would put a charge on a guest's bill
-- that nobody at the property ever agreed to, which is the same defect as the
-- room rates that shipped at 4099.
--
-- TWO EVENTS, NOT ONE
--
-- Cancelling and not turning up are different acts and hotels price them
-- differently: a cancellation inside the window is commonly one night, a
-- no-show commonly the whole stay. One set of columns for both would force
-- every property onto whichever it wrote first.
--
-- THE POLICY IS COPIED ONTO THE BOOKING, NOT REFERENCED FROM IT
--
-- Same reason `reservations.agreed_rate` is a column and not a lookup, stated
-- in 005: "if a rate plan changes in June, a booking made in March must not
-- silently change with it". Terms a guest agreed to in March are the March
-- terms. The link is kept for provenance; the numbers are frozen on the row.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The terms a property offers
-- -----------------------------------------------------------------------------
create table if not exists cancellation_policies (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  name          text not null,

  -- How many hours before check-in a guest may cancel for nothing.
  -- NULL means there is no free window at all — the charge applies from the
  -- moment the booking is made. 0 means free until the check-in instant.
  free_until_hours integer,

  -- What is retained on a CANCELLATION inside the window.
  cancel_basis    text not null,
  cancel_percent  numeric(5,2),
  cancel_amount   numeric(12,2),

  -- What is retained on a NO-SHOW. Usually harsher, always separate.
  no_show_basis   text not null,
  no_show_percent numeric(5,2),
  no_show_amount  numeric(12,2),

  is_active     boolean not null default true,
  created_by    uuid references staff(id),
  created_at    timestamptz not null default now(),

  constraint cancellation_policies_name_unique unique (hotel_id, name),

  -- 'nothing'      free, whatever the timing
  -- 'first_night'  one night at the agreed rate
  -- 'full_stay'    every night booked
  -- 'percent'      a share of the booking value
  -- 'flat'         a fixed sum in rupees
  constraint cancellation_policies_cancel_basis check (cancel_basis in (
    'nothing', 'first_night', 'full_stay', 'percent', 'flat')),
  constraint cancellation_policies_no_show_basis check (no_show_basis in (
    'nothing', 'first_night', 'full_stay', 'percent', 'flat')),

  -- A basis without its number is a policy that cannot be applied. Caught here
  -- rather than at the moment somebody is checking out and the figure is null.
  constraint cancellation_policies_cancel_figure check (
    (cancel_basis <> 'percent' or cancel_percent is not null) and
    (cancel_basis <> 'flat'    or cancel_amount  is not null)),
  constraint cancellation_policies_no_show_figure check (
    (no_show_basis <> 'percent' or no_show_percent is not null) and
    (no_show_basis <> 'flat'    or no_show_amount  is not null)),

  constraint cancellation_policies_percent_sane check (
    (cancel_percent  is null or cancel_percent  between 0 and 100) and
    (no_show_percent is null or no_show_percent between 0 and 100)),

  constraint cancellation_policies_hours_sane check (
    free_until_hours is null or free_until_hours >= 0)
);

create index if not exists cancellation_policies_hotel_idx
  on cancellation_policies (hotel_id) where is_active;

alter table cancellation_policies enable row level security;
alter table cancellation_policies force row level security;

drop policy if exists cancellation_policies_isolation on cancellation_policies;
create policy cancellation_policies_isolation on cancellation_policies
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

comment on table cancellation_policies is
  'What a cancellation or a no-show costs. Ships EMPTY: a property that has '
  'not written its terms down has none, and the night audit charges nothing '
  'rather than inventing a figure nobody agreed to.';


-- -----------------------------------------------------------------------------
-- The terms this booking was made under
-- -----------------------------------------------------------------------------
-- Frozen onto the row, not looked up. `agreed_rate` is a column for exactly
-- this reason and the same reason applies here.
--
-- All nullable. Every booking already in the system was made under no recorded
-- terms, and back-filling one would be asserting that a guest agreed to
-- something they were never shown.
-- -----------------------------------------------------------------------------
alter table reservations
  add column if not exists cancellation_policy_id uuid
    references cancellation_policies(id),
  add column if not exists cancel_terms text,
  add column if not exists cancel_free_until_hours integer,
  add column if not exists cancel_basis text,
  add column if not exists cancel_percent numeric(5,2),
  add column if not exists cancel_amount numeric(12,2),
  add column if not exists no_show_basis text,
  add column if not exists no_show_percent numeric(5,2),
  add column if not exists no_show_amount numeric(12,2);

comment on column reservations.cancel_terms is
  'The policy name as it read when the guest booked. Kept so a bill can say '
  'which terms were applied even after the policy is renamed or retired.';


-- -----------------------------------------------------------------------------
-- What is retained
-- -----------------------------------------------------------------------------
-- Returns NULL when the booking carries no terms — NOT zero. The difference is
-- the whole point: zero is a decision that nothing is owed, null is the absence
-- of any agreement, and the audit reports them differently.
--
-- STABLE, not IMMUTABLE: it reads the booking.
-- -----------------------------------------------------------------------------
create or replace function app.retention_for(
  p_reservation_id uuid,
  p_event          text          -- 'cancel' | 'no_show'
)
returns numeric
language plpgsql
stable
as $$
declare
  r        record;
  v_basis  text;
  v_pct    numeric;
  v_flat   numeric;
  v_nights integer;
begin
  select agreed_rate, check_in, check_out,
         cancel_basis, cancel_percent, cancel_amount,
         no_show_basis, no_show_percent, no_show_amount
    into r
    from reservations
   where id = p_reservation_id;

  if not found then
    return null;
  end if;

  if p_event = 'no_show' then
    v_basis := r.no_show_basis;
    v_pct   := r.no_show_percent;
    v_flat  := r.no_show_amount;
  else
    v_basis := r.cancel_basis;
    v_pct   := r.cancel_percent;
    v_flat  := r.cancel_amount;
  end if;

  -- No terms on this booking. Null, so the caller can say "no terms recorded"
  -- instead of "nothing is owed".
  if v_basis is null then
    return null;
  end if;

  -- Day-use books no nights. GREATEST keeps a same-day booking from computing
  -- a retention of zero on a full_stay policy.
  v_nights := greatest(1, (r.check_out - r.check_in));

  return case v_basis
    when 'nothing'     then 0::numeric
    when 'first_night' then round(r.agreed_rate, 2)
    when 'full_stay'   then round(r.agreed_rate * v_nights, 2)
    when 'percent'     then round(r.agreed_rate * v_nights * v_pct / 100, 2)
    when 'flat'        then round(v_flat, 2)
    else null
  end;
end $$;

comment on function app.retention_for(uuid, text) is
  'What a cancellation or no-show retains under the terms frozen on the '
  'booking. NULL when the booking carries no terms — which is not the same '
  'as zero, and the audit reports the two differently.';
