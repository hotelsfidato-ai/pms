-- =============================================================================
-- 098 · Equipment and stock count as trading — a property holding them is not deleted
-- =============================================================================
-- EQ-2, found by the equipment chat on 16 September. `app.forbid_hotel_delete`
-- (066) refuses to delete a property that has traded and NAMES what it found.
-- Its list predates the Store's ledger (069) and the equipment register (097).
-- A property with only a register passed the check; the cascade then reached
-- `equipment_history`, whose append-only trigger refused with a message about
-- posting a reversing entry — right to refuse, for a reason nobody at an
-- administration screen can act on. The Store's stock movements had the same
-- gap and, being a ledger too, the same answer.
--
-- The rule 066 states, applied: an append-only table that cascades from
-- `hotels` is evidence of trading, and joins this list the day it is created.
--
-- `create or replace` — safe to replay on every deploy.
-- =============================================================================

create or replace function app.forbid_hotel_delete()
returns trigger
language plpgsql
as $$
declare
  evidence text;
begin
  -- Everything that means a real person did a real thing here, counted in one
  -- pass so the message names all of it at once (066).
  select string_agg(format('%s %s', w.n, w.label), ', ' order by w.label)
    into evidence
    from (
      select 'reservations'    as label, count(*) as n from reservations    where hotel_id = old.id
      union all select 'folios',         count(*) from folios              where hotel_id = old.id
      union all select 'postings',       count(*) from folio_postings      where hotel_id = old.id
      union all select 'invoices',       count(*) from invoices            where hotel_id = old.id
      union all select 'payments',       count(*) from payments            where hotel_id = old.id
      union all select 'restaurant orders', count(*) from pos_orders       where hotel_id = old.id
      union all select 'banquet events', count(*) from banquet_events      where hotel_id = old.id
      union all select 'night audits',   count(*) from night_audit_runs    where hotel_id = old.id
      union all select 'cashier shifts', count(*) from cashier_shifts      where hotel_id = old.id
      union all select 'till day ends',  count(*) from pos_day_ends        where hotel_id = old.id
      union all select 'work orders',    count(*) from work_orders         where hotel_id = old.id
      -- 098: the two ledgers that came later
      union all select 'stock movements', count(*) from stock_movements    where hotel_id = old.id
      union all select 'equipment items', count(*) from equipment_items    where hotel_id = old.id
    ) w
   where w.n > 0;

  if evidence is not null then
    raise exception
      'A property that has traded is deactivated, never deleted.'
      using detail = format('%s still has %s.', old.code, evidence),
            hint   = 'update hotels set is_active = false where code = '
                     || quote_literal(old.code);
  end if;

  return old;
end $$;

comment on function app.forbid_hotel_delete() is
  'Refuses to delete a property that has traded, naming what it found. A '
  'property with no reservations, folios, invoices, payments, orders, '
  'events, audits, shifts, work orders, stock movements or equipment is '
  'commissioning scaffolding and may be removed. Audit rows survive either way.';
