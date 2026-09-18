-- =============================================================================
-- 096 · Who asked, by name — and retiring equipment in the same approvals inbox
-- =============================================================================
-- THE OWNER'S DECISIONS, 16 September:
--
--   NAMES   "Yes, show names": at their own hotel, the person who approves and
--           the store keeper see the name of who asked for something, or who
--           took stock — not a dash.
--   S16     The Inventory Manager may approve a retirement too (a tagged item
--           retired by a Hotel Manager waits, as the owner told the equipment
--           chat), with the owner, an administrator or the GM as backup —
--           and in ONE inbox, the shared approvals queue, not a second one.
--
-- WHY A FUNCTION FOR A NAME. `staff` is row-secured (027): most roles read only
-- their own row. 027's `staff_colleague_read` meant to let people rostered at
-- the same property see each other, but it reads `staff_hotels`, which is itself
-- secured to your own rows — so for everyone but a group admin it matches
-- nobody. A join to `staff` for a label therefore hid rows (MEMORY 283) or
-- printed nothing (the Store's STO-4).
--
-- `app.colleague_name` answers ONE thing: the full name of a person rostered at
-- a property the caller is rostered at. Not their email, phone or role, not a
-- list — a name, given an id the caller already holds from a row they may read.
-- WHERE a name is shown stays the API's decision, per the owner's answer.
--
-- SECURITY DEFINER, owned by the migrator (BYPASSRLS since 068). It still
-- checks the caller's own hotels through `app.auth_hotel_ids()`, which reads the
-- session's `app.user_id` — so it can never answer for a property the caller is
-- not at.
-- =============================================================================


-- ---------- a colleague's name ----------
create or replace function app.colleague_name(p_staff uuid, p_hotel uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s.full_name
    from staff s
   where s.id = p_staff
     and p_hotel in (select app.auth_hotel_ids())
     and (
       exists (select 1 from staff_hotels sh
                where sh.staff_id = s.id and sh.hotel_id = p_hotel)
       or s.is_group_admin
     )
$fn$;

revoke all on function app.colleague_name(uuid, uuid) from public;
grant execute on function app.colleague_name(uuid, uuid) to pms_app;

comment on function app.colleague_name(uuid, uuid) is
  'The name of someone rostered at a property the caller is also rostered at '
  '(or a group admin), else null. A name only. Where it is shown is the API''s '
  'decision -- the owner, 16 September: approvers and the store keeper.';


-- ---------- retiring equipment: a second kind, the same inbox ----------
-- Guarded exactly as 095 is, and for the same reason (MEMORY 284): only when
-- the list does not know this kind yet, so a replay never shrinks it.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'approval_rules_kind_known'
                    and pg_get_constraintdef(oid) like '%equipment_retire%') then
    alter table approval_rules drop constraint if exists approval_rules_kind_known;
    alter table approval_rules add constraint approval_rules_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment',
               'equipment_issue', 'equipment_retire'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'approvals_kind_known'
                    and pg_get_constraintdef(oid) like '%equipment_retire%') then
    alter table approvals drop constraint if exists approvals_kind_known;
    alter table approvals add constraint approvals_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment',
               'equipment_issue', 'equipment_retire'));
  end if;
end $$;

insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'equipment_retire', 'stores', null, array['owner', 'admin', 'gm']
  from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

-- The new-property trigger from 095 now writes both rules.
create or replace function app.equipment_rule_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'equipment_issue',  'stores', null, array['owner', 'admin', 'gm']),
         (new.id, 'equipment_retire', 'stores', null, array['owner', 'admin', 'gm'])
  on conflict (hotel_id, kind, approver_role) do nothing;
  return new;
end $fn$;
