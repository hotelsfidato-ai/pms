-- =============================================================================
-- 095 · Equipment leaving the store waits for the Inventory Manager
-- =============================================================================
-- THE OWNER'S DECISIONS, 16 September (docs/STOCK-AND-EQUIPMENT-PLAN.md, S12–S15):
--
--   S12  Equipment going OUT of the store — to a room, the kitchen, the
--        restaurant — waits for approval. Stock (oil, gas, drinks) does not.
--        Moving between rooms, or back into the store, is recorded and needs
--        nobody.
--   S13  The Inventory Manager approves. That is the `stores` role, renamed on
--        screen from "Store Manager"; the key does not change.
--   S14  When the Inventory Manager is not there, the owner, an administrator
--        or the general manager may decide instead.
--   S15  Anybody who can see equipment may ask.
--
-- This migration is the approvals half only. The register, the move and the
-- request itself are the equipment service's (phase 1B), which raises the
-- request with `app.request_approval(hotel, 'equipment_issue', <its table>,
-- <the move>, <why>, null, <who>)` and treats the move as done once approved.
--
-- WHY A SECOND LIST OF DECIDERS. Until now an approval had exactly ONE role
-- that could decide it, plus the group owner (076, api/src/routes/approvals.ts).
-- S14 needs a named first approver AND named backups. Adding three more rules
-- for the same kind would not do it: `app.request_approval` picks ONE rule and
-- freezes ONE role, so the queue would say "for the general manager" and the
-- Inventory Manager could not decide their own queue. So a rule carries
-- `also_decided_by`, frozen onto the request exactly as `approver_role` is —
-- changing the rule tomorrow must not re-route what is already waiting.
--
-- The purchase rule is untouched: its `also_decided_by` is empty, so a GM
-- still cannot approve a purchase the owner's rule sends to the owner.
--
-- NOBODY APPROVES THEIR OWN REQUEST still holds (076, in the database). When
-- the Inventory Manager takes something out themselves, the GM, an
-- administrator or the owner approves it.
-- =============================================================================


-- ---------- the new kind ----------
-- ⚠ ONLY IF THE LIST DOES NOT ALREADY KNOW IT (MEMORY 284). Every deploy
-- replays every migration. Written plainly, this drop-and-add ran again after
-- 096 had stored `equipment_retire` rows, re-added a list without that kind,
-- and failed — so every deploy after the first would have stopped here. A
-- later migration that adds a kind uses the same guard, with its own kind,
-- and never edits this one.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'approval_rules_kind_known'
                    and pg_get_constraintdef(oid) like '%equipment_issue%') then
    alter table approval_rules drop constraint if exists approval_rules_kind_known;
    alter table approval_rules add constraint approval_rules_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment', 'equipment_issue'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'approvals_kind_known'
                    and pg_get_constraintdef(oid) like '%equipment_issue%') then
    alter table approvals drop constraint if exists approvals_kind_known;
    alter table approvals add constraint approvals_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment', 'equipment_issue'));
  end if;
end $$;


-- ---------- who else may decide ----------
alter table approval_rules
  add column if not exists also_decided_by text[] not null default '{}';
alter table approvals
  add column if not exists also_decided_by text[] not null default '{}';

comment on column approval_rules.also_decided_by is
  'Roles that may decide as well as approver_role -- the backups when that '
  'person is away. Empty means only approver_role (and the group owner).';
comment on column approvals.also_decided_by is
  'Frozen from the rule when the request was raised, like approver_role.';


-- ---------- raising one: the same function, freezing the backups too ----------
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
declare v_role text; v_also text[]; v_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A % needs a reason before it can be approved.', p_kind
      using errcode = 'check_violation';
  end if;

  /* The narrowest rule that applies, exactly as 076 chose it. */
  select r.approver_role, r.also_decided_by into v_role, v_also
    from approval_rules r
   where r.hotel_id = p_hotel
     and r.kind = p_kind
     and r.is_active
     and (r.over_amount is null or coalesce(p_amount, 0) > r.over_amount)
   order by r.over_amount desc nulls last
   limit 1;

  -- No rule: nothing to approve. NOT an error (076).
  if v_role is null then
    return null;
  end if;

  insert into approvals
    (hotel_id, kind, subject_table, subject_id, reason, amount,
     requested_by, approver_role, also_decided_by)
  values
    (p_hotel, p_kind, p_table, p_subject, trim(p_reason), p_amount,
     p_by, v_role, coalesce(v_also, '{}'))
  returning id into v_id;

  return v_id;
end $fn$;

comment on function app.request_approval(uuid, text, text, uuid, text, numeric, uuid) is
  'Raises an approval if a rule calls for one, freezing who decides and who '
  'may decide instead. Returns null when no rule applies, which means proceed.';


-- ---------- the owner's rule, at every property ----------
-- A row, as 076 insists, so it stays the owner's to change on the rules
-- endpoint. Written for every property that exists now...
insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'equipment_issue', 'stores', null, array['owner', 'admin', 'gm']
  from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

-- ...and for every property created after. Without this a new hotel would let
-- equipment leave its store with nobody asked, and nothing would say so.
--
-- SECURITY DEFINER because approval_rules is FORCE row level security and a
-- property being created is not yet among the creator's hotels. It owns
-- nothing but this one insert. On production the owner is `pms_migrate`, which
-- holds BYPASSRLS since 068; the test database runs as a superuser, so this is
-- one privilege the gate cannot prove (068's own warning).
create or replace function app.equipment_rule_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'equipment_issue', 'stores', null, array['owner', 'admin', 'gm'])
  on conflict (hotel_id, kind, approver_role) do nothing;
  return new;
end $fn$;

revoke all on function app.equipment_rule_for_new_property() from public;

drop trigger if exists hotels_equipment_rule on hotels;
create trigger hotels_equipment_rule
  after insert on hotels
  for each row execute function app.equipment_rule_for_new_property();
