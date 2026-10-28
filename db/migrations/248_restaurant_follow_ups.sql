-- =============================================================================
-- 248 · The restaurant's follow-ups (the owner's D27-372, 28 October)
-- =============================================================================
-- Two things the database now keeps:
--
--   * WHO CLOSED AN ORDER UNPAID, AND WHEN. Close unpaid (028's 'abandoned')
--     kept its reason only. From now on the till writes who and when beside
--     it, and the Voids report prints them. Orders closed before this stay
--     null and print "-": nobody can say now who closed them.
--
--   * A JOINED TABLE SHOWS 'JOINED TO AC3' until the bill it joined is
--     settled or closed (244 freed it at once). app.pos_joined_to(table)
--     answers which open bill a table's food went onto - following a bill
--     that was itself joined to another - so Tables can say so, and a move
--     or a new bill there is refused while it does. Nothing is stored: the
--     moment that bill is settled or closed, the table is free.
--
-- Re-runnable (db/tests/rerun.sh): `if not exists`, and create or replace
-- with the same signature.
-- =============================================================================

alter table pos_orders add column if not exists abandoned_by uuid references staff(id);
alter table pos_orders add column if not exists abandoned_at timestamptz;

comment on column pos_orders.abandoned_by is
  'D27-372: who closed this order unpaid. Null on an order closed before 28 October 2026 - '
  'not recorded then.';
comment on column pos_orders.abandoned_at is
  'D27-372: when this order was closed unpaid. Null on an order closed before 28 October 2026.';

-- The joined orders of a table, read on every floor load.
create index if not exists pos_orders_joined_table
  on pos_orders (table_id) where status = 'joined';

create or replace function app.pos_joined_to(p_table uuid)
returns table (order_id uuid, order_no text, table_ref text)
language sql
stable
as $$
  with recursive up as (
    select o.joined_into as id
      from pos_orders o
     where o.table_id = p_table and o.status = 'joined'
    union
    select k.joined_into
      from up join pos_orders k on k.id = up.id
     where k.status = 'joined'
  )
  select k.id, k.order_no, k.table_ref
    from up join pos_orders k on k.id = up.id
   where k.status = 'open'
   limit 1
$$;

comment on function app.pos_joined_to(uuid) is
  'D27-372: the open bill this table''s food was joined onto, through any bill that was '
  'itself joined; none once that bill is settled or closed. Tables shows "joined to" its table.';

grant execute on function app.pos_joined_to(uuid) to pms_app;
