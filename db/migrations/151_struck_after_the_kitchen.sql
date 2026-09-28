-- =============================================================================
-- 151 · A dish struck after it reached the kitchen says why (D27-119)
-- =============================================================================
-- The owner, 28 September (QA POS-4): striking a dish the kitchen already has
-- is for the owner, an administrator, the GM, the hotel manager or the kitchen
-- manager - never a waiter - and always WITH A REASON, shown on the kitchen
-- docket, the Kitchen screen, Close restaurant day and the night audit.
--
-- Also here: a paid dish can still be moved along at the pass (QA POS-1), below.
--
-- WHO is asked in the till's routes (api/src/modules/pos/till.ts,
-- STRIKES_SENT). The REASON is also a promise the database keeps: a dish
-- struck once the kitchen had it carries one. NOT VALID, so lines struck
-- before today (no reason was ever asked) stay as they are; every new strike
-- is checked. An add-on is exempt - it is struck with its dish, by 045's
-- trigger, and the dish carries the reason.
-- =============================================================================

alter table pos_order_lines add column if not exists void_reason text;

comment on column pos_order_lines.void_reason is
  'Why the line was struck. Required once the kitchen had it (D27-119).';

alter table pos_order_lines
  drop constraint if exists pos_order_lines_sent_strike_says_why;
alter table pos_order_lines
  add constraint pos_order_lines_sent_strike_says_why check (
    not (voided and was_sent_when_voided and parent_line_id is null)
    or length(trim(coalesce(void_reason, ''))) > 0) not valid;


-- -----------------------------------------------------------------------------
-- The day's list: every dish struck after the kitchen had it
-- -----------------------------------------------------------------------------
-- One definition, read by Close restaurant day (per outlet) and by the night
-- audit (the whole hotel). The value is before tax, what the dish was sold at.
-- A LEFT join to staff: a name the reader may not see is a dash, not a missing
-- line (MEMORY 283).
-- -----------------------------------------------------------------------------
create or replace function app.pos_struck_after_kitchen(p_hotel uuid, p_date date)
returns table (
  outlet_id  uuid,
  order_no   text,
  table_ref  text,
  name       text,
  qty        numeric,
  value      numeric,
  reason     text,
  struck_by  text,
  struck_at  timestamptz
)
language sql stable as $$
  select o.outlet_id, o.order_no, o.table_ref, l.name, l.qty,
         round(l.qty * l.unit_price, 2), l.void_reason, s.full_name, l.voided_at
    from pos_order_lines l
    join pos_orders o on o.id = l.order_id
    left join staff s on s.id = l.voided_by
   where o.hotel_id = p_hotel
     and o.business_date = p_date
     and l.voided and l.was_sent_when_voided
     and l.parent_line_id is null
   order by l.voided_at;
$$;

comment on function app.pos_struck_after_kitchen(uuid, date) is
  'Dishes struck after the kitchen had them, with who and why (D27-119). '
  'Read by Close restaurant day and the night audit.';

grant execute on function app.pos_struck_after_kitchen(uuid, date) to pms_app;


-- -----------------------------------------------------------------------------
-- A paid dish can still be carried out of the kitchen (QA POS-1)
-- -----------------------------------------------------------------------------
-- Room service and take-away are paid, or charged to the room, when they are
-- ordered - before anybody cooks them. The pass now shows them (till.ts), and
-- the chef has to be able to move them to preparing, ready and served. 028's
-- freeze refused every change to a settled order's lines, that move included.
--
-- The one change let through: the kitchen status and nothing else. The bill -
-- every price, quantity, strike and the tax - stays exactly as frozen as it was.
-- -----------------------------------------------------------------------------
create or replace function app.pos_order_lines_frozen()
returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from pos_orders
   where id = coalesce(new.order_id, old.order_id);

  if st is distinct from 'open' then
    if tg_op = 'UPDATE'
       and to_jsonb(new) - 'kot_status' = to_jsonb(old) - 'kot_status' then
      return new;
    end if;
    raise exception
      'Order % is %, so its lines cannot change. Settle corrections with a '
      'credit on the folio, not by editing a paid bill.',
      coalesce(new.order_id, old.order_id), st
      using errcode = 'integrity_constraint_violation';
  end if;

  return coalesce(new, old);
end $$;
