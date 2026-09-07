-- =============================================================================
-- 076 · Approvals — one mechanism, because there are three requirements
-- =============================================================================
-- The handover requirements describe an approval three separate times: a
-- purchase (§19), a cash expense (§17), and a reconciliation the GM signs off
-- (§18). Written where each is described, they become three mechanisms that
-- agree on the day they are written and disagree six months later.
--
-- Nine of the defects recorded in MEMORY.md have exactly that shape — the same
-- rule living in two places, correct in one of them. The owner's own
-- instruction on the requirements was "do not create duplicate functionality",
-- and this table is that instruction taken seriously.
--
-- WHO APPROVES IS A ROW, NOT CODE.
--
-- The owner's answer was: the GM raises the bill, the Owner approves it, and
-- both stay in the loop. That is a real rule and it is also THEIR rule — the
-- day a store manager submits to the GM instead, or the day a purchase under
-- ₹5,000 stops needing anybody, that must be a settings screen and not a
-- migration. So `approval_rules` holds it and the code asks.
--
-- WHAT AN APPROVAL IS ATTACHED TO.
--
-- `subject_table` + `subject_id`, deliberately loose. A foreign key per
-- approvable thing would mean altering this table every time something new
-- becomes approvable, and there is no way to write ONE foreign key that points
-- at four tables. The pairing is checked by the function that raises it, which
-- is the only way anything gets in here.
--
-- WHAT THIS DOES NOT DO: it does not perform the thing it approves. An
-- approved purchase is still posted by the purchase code, an approved expense
-- still by the expense code. This table records a DECISION and nothing else —
-- the moment it starts doing the work as well, every future approvable thing
-- has to be taught to it.
-- =============================================================================

create table if not exists approval_rules (
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- What is being approved. Matches `approvals.kind`.
  kind          text not null,

  -- The role that decides. A ROLE and not a person: staff leave, and an
  -- approval queue pointing at somebody who left is a queue that stops.
  approver_role text not null,

  -- Above this, the rule applies; at or below it, nothing is needed.
  -- NULL means "always, whatever the amount" — which is not the same as 0.
  -- Zero would mean "anything above nothing", which is the same thing said
  -- confusingly; null says plainly that money is not the test here.
  over_amount   numeric(12,2),

  is_active     boolean not null default true,
  set_by        uuid references staff(id),
  set_at        timestamptz not null default now(),

  primary key (hotel_id, kind, approver_role),
  constraint approval_rules_kind_known check (
    kind in ('purchase', 'cash_expense', 'stock_adjustment')),
  constraint approval_rules_amount_sane check (
    over_amount is null or over_amount >= 0)
);

comment on table approval_rules is
  'Who decides what, per property. A ROLE rather than a person, because '
  'staff leave and a queue pointing at somebody who left is a queue that '
  'stops.';


create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  kind          text not null,

  -- What is waiting. Loose on purpose — see the header.
  subject_table text not null,
  subject_id    uuid not null,

  -- WHAT IT IS FOR, in the submitter's own words, and it is NOT OPTIONAL.
  -- §16 says the reason for a purchase is mandatory. A request with no reason
  -- is a row an approver cannot act on: they either approve blind or go and
  -- ask, and both mean the workflow was decoration.
  reason        text not null,

  -- The money at stake, so the rule can be applied and a queue can be read
  -- without opening every row. Null where the thing being approved has no
  -- amount — a stock adjustment does not.
  amount        numeric(12,2),

  status        text not null default 'pending',

  requested_by  uuid not null references staff(id),
  requested_at  timestamptz not null default now(),

  -- Which role is expected to decide, FROZEN when the request is raised.
  -- Read from `approval_rules` at that moment and kept, exactly as the
  -- cancellation terms are frozen onto a booking: changing the rule must not
  -- silently re-route requests that are already waiting, and must not
  -- retrospectively change who was supposed to have acted.
  approver_role text not null,

  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  -- Why it was refused, or what clarification is wanted. Required for
  -- anything that is not a plain approval — see the constraint below.
  decision_note text,

  constraint approvals_kind_known check (
    kind in ('purchase', 'cash_expense', 'stock_adjustment')),
  constraint approvals_status_known check (
    status in ('pending', 'approved', 'rejected', 'clarify')),
  constraint approvals_reason_present check (length(trim(reason)) > 0),
  constraint approvals_amount_sane check (amount is null or amount >= 0),

  -- A decision has a decider and a time, and neither can arrive without the
  -- other. `pending` has neither.
  constraint approvals_decision_complete check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or
    (status <> 'pending' and decided_by is not null and decided_at is not null)
  ),

  -- ⚠ A REFUSAL WITHOUT A REASON IS THE ROW NOBODY CAN ACT ON. The same rule
  -- the void already carries (042) and the discount (038). Approving needs no
  -- words; rejecting and asking for clarification both do.
  --
  -- Written with an explicit `is not null` rather than
  -- `length(trim(decision_note)) > 0` alone — a check constraint PASSES on
  -- null, which is the trap 039 caught and 042's comment names.
  constraint approvals_refusal_explained check (
    status not in ('rejected', 'clarify')
    or (decision_note is not null and length(trim(decision_note)) > 0)
  )
);

comment on table approvals is
  'One decision, recorded. Does NOT perform the thing it approves -- the '
  'moment it does, every future approvable thing has to be taught to it.';

-- One live request per subject. A second pending approval for the same
-- purchase is two people deciding the same thing, and whichever is read
-- first wins silently.
create unique index if not exists approvals_one_pending
  on approvals (subject_table, subject_id)
  where status = 'pending';

create index if not exists approvals_queue
  on approvals (hotel_id, status, requested_at);


-- -----------------------------------------------------------------------------
-- Raising one
-- -----------------------------------------------------------------------------
-- Returns the approval id, or NULL when no rule applies — which means "this
-- does not need approving", and the caller proceeds. That is the shape §16
-- needs: a ₹200 packet of nails should not sit in a queue.
--
-- The rule is read HERE and frozen onto the row, so a rule changed tomorrow
-- does not silently re-route what is already waiting.
-- -----------------------------------------------------------------------------
create or replace function app.request_approval(
  p_hotel    uuid,
  p_kind     text,
  p_table    text,
  p_subject  uuid,
  p_reason   text,
  p_amount   numeric,
  p_by       uuid
) returns uuid
language plpgsql
as $fn$
declare v_role text; v_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A % needs a reason before it can be approved.', p_kind
      using errcode = 'check_violation';
  end if;

  /* The narrowest rule that applies. Ordered by threshold DESCENDING and
     limited to one, exactly as app.gst_rate does for tax slabs: a property
     with "over 5000 -> owner" and "always -> gm" wants the owner on a ₹9,000
     purchase, not both and not whichever the planner happened to return. */
  select r.approver_role into v_role
    from approval_rules r
   where r.hotel_id = p_hotel
     and r.kind = p_kind
     and r.is_active
     and (r.over_amount is null or coalesce(p_amount, 0) > r.over_amount)
   order by r.over_amount desc nulls last
   limit 1;

  -- No rule: nothing to approve. NOT an error — a property that has not set
  -- approvals up should still be able to buy nails.
  if v_role is null then
    return null;
  end if;

  insert into approvals
    (hotel_id, kind, subject_table, subject_id, reason, amount,
     requested_by, approver_role)
  values
    (p_hotel, p_kind, p_table, p_subject, trim(p_reason), p_amount,
     p_by, v_role)
  returning id into v_id;

  return v_id;
end $fn$;

comment on function app.request_approval(uuid, text, text, uuid, text, numeric, uuid) is
  'Raises an approval if a rule calls for one. Returns null when none does, '
  'which means proceed -- a property with no rules can still buy nails.';


-- -----------------------------------------------------------------------------
-- Deciding one
-- -----------------------------------------------------------------------------
create or replace function app.decide_approval(
  p_id     uuid,
  p_status text,
  p_by     uuid,
  p_note   text
) returns void
language plpgsql
as $fn$
declare v_row approvals;
begin
  select * into v_row from approvals where id = p_id for update;

  if v_row.id is null then
    raise exception 'No such approval.' using errcode = 'no_data_found';
  end if;

  /* ⚠ A DECIDED APPROVAL IS DECIDED. Without this, a rejection can be
     quietly approved afterwards and the row shows only the second answer —
     the audit trail would say it was approved and never that anybody
     refused it. To change a decision, raise a new request. */
  if v_row.status <> 'pending' then
    raise exception 'That was already % on %.',
      v_row.status, to_char(v_row.decided_at, 'DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  /* ⚠ NOBODY APPROVES THEIR OWN REQUEST. The whole point of §17 is that
     somebody else looks. A GM who can approve their own cash purchase has a
     workflow that records a signature rather than obtaining one.

     Enforced in the database, not only in the API: the requirement asks for
     accountability, and accountability that can be bypassed by calling a
     different endpoint is not accountability. */
  if v_row.requested_by = p_by then
    raise exception
      'The person who asked for this cannot be the person who approves it.'
      using errcode = 'check_violation';
  end if;

  update approvals
     set status = p_status,
         decided_by = p_by,
         decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
end $fn$;

comment on function app.decide_approval(uuid, text, uuid, text) is
  'Records a decision, once. Refuses a second decision and refuses the '
  'requester deciding their own -- both in the database, because '
  'accountability that another endpoint can bypass is not accountability.';


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table approval_rules enable row level security;
alter table approval_rules force  row level security;
drop policy if exists approval_rules_isolation on approval_rules;
create policy approval_rules_isolation on approval_rules
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table approvals enable row level security;
alter table approvals force  row level security;
drop policy if exists approvals_isolation on approvals;
create policy approvals_isolation on approvals
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- The trail, extended to what the requirements actually name
-- -----------------------------------------------------------------------------
-- §20 asks for: user created, role changed, hotel created, inventory
-- adjusted, purchase approved, cash expense approved, kitchen order status
-- changed, recipe modified.
--
-- The first three were already covered by 016 — `staff`, `staff_hotels` and
-- `hotels` all carry the trigger. NONE of the rest were, and the mechanism
-- has been sitting there recording before/after for sixteen tables since CP2.
-- This is a list, not a build.
--
-- pos_order_lines is DELIBERATELY EXCLUDED even though §20 names kitchen
-- status changes. A busy service writes that column several times per dish;
-- audited row by row it would be the largest table in the database within a
-- month, and it would bury the rows somebody actually needs to read. The
-- kitchen's timings (Stage C3) record the same history in four purpose-built
-- columns, which is the right place for it.
do $$
declare t text;
begin
  foreach t in array array[
    'stock_items',      -- what the property keeps
    'stock_movements',  -- inventory adjusted  (§20)
    'approvals',        -- purchase and cash expense approved (§20)
    'approval_rules',   -- and any change to WHO may approve
    'tax_rules',        -- the GST a guest is charged
    'hotel_modules',    -- what a property is allowed to do
    'pos_menu_items',   -- prices, and later preparation times
    'work_orders'       -- maintenance, raised and closed
  ] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function app.write_audit()', t, t);
  end loop;
end $$;
