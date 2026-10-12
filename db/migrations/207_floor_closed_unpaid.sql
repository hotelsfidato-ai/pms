-- =============================================================================
-- 207 · A bill closed unpaid shows as "Closed unpaid - clear it" (POS-33, the
--       owner's report and answer of 9 October)
-- =============================================================================
-- Close unpaid (a walkout, a duplicate) sets the order `abandoned` and leaves
-- it on its table, as a settled bill is left until somebody clears it. But
-- 047's floor had no word for it: an abandoned order fell through to `running`
-- (blue) or `kot` (orange), or `printed` (green) once its bill was printed,
-- still showing the bill's total - and the Tables screen offers Clear only on
-- a paid tile, so nothing on it could ever free the table. The owner, 9 October:
-- "I am not able to clear the table for the next guests to come, and the old
-- amount is still staying on the table."
--
-- Their answer: a Clear button, as a paid table has, so the table is reset
-- before it shows free. So: a sixth state, `closed`, ahead of every other but
-- blank - an abandoned bill is finished whatever happened to it before - and
-- no amount on it, because nobody is collecting one. The Clear route already
-- accepts an abandoned order (it refuses only an open one).
--
-- Everything else is 047's function unchanged. Tables stuck today free
-- themselves: they show `closed`, and Clear clears them.
--
-- Re-runnable (create or replace, the same signature; the grant stays).
-- =============================================================================

-- `state` in the order a tile cares about, most-urgent last:
--
--   blank    nothing on it
--   running  an order open, nothing sent to the kitchen yet
--   kot      lines have gone to the kitchen — food is being cooked
--   printed  the bill has been printed; the guest is paying
--   paid     settled, and the table still needs resetting
--   closed   closed unpaid, and the table still needs resetting (207)
-- -----------------------------------------------------------------------------
create or replace function app.pos_floor(p_outlet uuid)
returns table (
  section_id   uuid,
  section      text,
  table_id     uuid,
  label        text,
  seats        smallint,
  row_no       smallint,
  col_no       smallint,
  order_id     uuid,
  order_no     text,
  state        text,
  opened_at    timestamptz,
  minutes      int,
  payable      numeric
)
language sql stable as $$
  with live as (
    /* The order sitting on each table: the most recent one not yet
       cleared. distinct on, so a table that has had four orders today
       shows the current one and not the first. */
    select distinct on (o.table_id)
           o.table_id, o.id, o.order_no, o.status, o.opened_at,
           o.printed_at,
           exists (select 1 from pos_order_lines l
                    where l.order_id = o.id and not l.voided
                      and l.kot_status <> 'pending') as sent
      from pos_orders o
     where o.table_id is not null and o.cleared_at is null
     order by o.table_id, o.opened_at desc
  )
  select
    s.id, s.name, t.id, t.label, t.seats, t.row_no, t.col_no,
    l.id, l.order_no,
    case
      when l.id is null            then 'blank'
      when l.status = 'abandoned'  then 'closed'
      when l.status = 'settled'    then 'paid'
      when l.printed_at is not null then 'printed'
      when l.sent                  then 'kot'
      else 'running'
    end,
    l.opened_at,
    case when l.opened_at is null then null
         else greatest(0, (extract(epoch from now() - l.opened_at) / 60)::int)
    end,
    /* Nothing is being collected on a bill closed unpaid: no amount on its
       tile, as on a free one. The bill keeps its total on the Till. */
    case when l.id is null or l.status = 'abandoned' then null
         else (select payable from app.pos_order_total(l.id)) end
  from pos_sections s
  join pos_tables t on t.section_id = s.id and t.is_active
  left join live l on l.table_id = t.id
 where s.outlet_id = p_outlet and s.is_active
 order by s.sort_order, s.name, t.row_no, t.col_no, t.label;
$$;

comment on function app.pos_floor(uuid) is
  'Every table with whatever is on it, and the state its tile should show. '
  'Derived: a stored colour is a sixth thing to keep in step, and the one '
  'that will be wrong on the night a manager is watching. A bill closed '
  'unpaid is `closed`, with no amount, until its table is cleared (207).';
