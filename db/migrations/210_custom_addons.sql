-- =============================================================================
-- 210 · Custom add-ons, and add-ons on a dish the kitchen already has (D27-291)
-- =============================================================================
-- The owner, 9 October: "a guest wants something we don't offer - type its
-- name and price and add it to the dish, even a dish already sent". And on a
-- dish already sent, the numbered add-ons too.
--
-- BOTH ARE A LINE OF THEIR OWN UNDER THE DISH ("Veg Thali 300 / + Extra papad
-- 40"), as a side is: a line carries its own name, price, quantity and tax,
-- so the totals, the discount, the per-rate folio posting and the VAT bill
-- take it without being taught anything. Unlike a side it has ITS OWN
-- QUANTITY (the owner: one papad for two thalis is one), and it may go on
-- after the dish was sent - it waits for the next Send like any new dish and
-- prints on that KOT naming the dish it is for.
--
-- (1) `extra_kind` says which: 'custom' (typed by staff) or 'numbered' (one of
--     208's list, `numbered_addon_id`). 045's rule that a child line IS a
--     side widens to "a side or an extra". An extra names no dish of the menu
--     and folds nothing (208's numbered_addons is the dish's own).
--
-- (2) A SENT EXTRA STRUCK SAYS WHY, as a sent dish does (151): it was food the
--     kitchen had. A side still follows its dish and asks nothing. Striking a
--     dish strikes its extras (045's cascade), and they carry the dish's reason.
--
-- (3) The day's struck-after-kitchen list (151) names them: "+ Extra papad
--     (for Veg Thali)".
--
-- Re-runnable.
-- =============================================================================

-- (1) ------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists extra_kind text,
  add column if not exists numbered_addon_id uuid references pos_numbered_addons(id);

comment on column pos_order_lines.extra_kind is
  'An add-on as a line of its own under its dish (D27-291): custom (typed by '
  'staff) or numbered (one of the numbered list, on a dish already sent). Its '
  'own quantity; it waits for the next Send like any new dish.';
comment on column pos_order_lines.numbered_addon_id is
  'Which numbered add-on an extra line is, when it is one (D27-291).';

alter table pos_order_lines drop constraint if exists pos_order_lines_extra_kind_known;
alter table pos_order_lines
  add constraint pos_order_lines_extra_kind_known
  check (extra_kind is null or extra_kind in ('custom', 'numbered'));

-- An extra hangs under a dish, names no menu item, is no side and folds
-- nothing; a numbered one says which. coalesce: a CHECK passes on NULL (209).
alter table pos_order_lines drop constraint if exists pos_order_lines_extra_shape;
alter table pos_order_lines
  add constraint pos_order_lines_extra_shape check (
    extra_kind is null
    or coalesce(
         parent_line_id is not null
         and addon_id is null
         and item_id is null
         and variation_id is null
         and numbered_addons is null
         and (extra_kind = 'numbered') = (numbered_addon_id is not null),
       false));

alter table pos_order_lines drop constraint if exists pos_order_lines_numbered_id_on_extra;
alter table pos_order_lines
  add constraint pos_order_lines_numbered_id_on_extra
  check (numbered_addon_id is null or extra_kind = 'numbered');

-- 045's "a child line is a side", widened to "a side or an extra".
alter table pos_order_lines drop constraint if exists pos_order_lines_child_is_addon;
alter table pos_order_lines
  add constraint pos_order_lines_child_is_addon
  check (parent_line_id is null or addon_id is not null or extra_kind is not null);

-- The Add-ons tab's "Custom add-ons used" (D27-291) reads these.
create index if not exists pos_order_lines_custom_idx
  on pos_order_lines (hotel_id, added_at) where extra_kind = 'custom';

-- (2) ------------------------------------------------------------------------
-- 151's rule, for a dish AND for an extra. NOT VALID, as 151's was: it holds
-- every new strike and leaves history alone.
alter table pos_order_lines drop constraint if exists pos_order_lines_sent_strike_says_why;
alter table pos_order_lines
  add constraint pos_order_lines_sent_strike_says_why check (
    not (voided and was_sent_when_voided
         and (parent_line_id is null or extra_kind is not null))
    or length(trim(coalesce(void_reason, ''))) > 0) not valid;

-- 045's cascade, carrying the dish's reason to what hangs under it.
create or replace function app.pos_void_cascades_to_addons()
returns trigger language plpgsql as $$
begin
  if new.voided and not old.voided then
    update pos_order_lines
       set voided = true, voided_by = new.voided_by, voided_at = new.voided_at,
           void_reason = coalesce(void_reason, new.void_reason)
     where parent_line_id = new.id and not voided;
  end if;
  return new;
end $$;

-- (3) ------------------------------------------------------------------------
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
  select o.outlet_id, o.order_no, o.table_ref,
         case when l.extra_kind is null then l.name
              else '+ ' || l.name || ' (for '
                   || coalesce(p.numbered_addons ->> 'dish', p.name) || ')' end,
         l.qty, round(l.qty * l.unit_price, 2), l.void_reason, s.full_name, l.voided_at
    from pos_order_lines l
    join pos_orders o on o.id = l.order_id
    left join pos_order_lines p on p.id = l.parent_line_id
    left join staff s on s.id = l.voided_by
   where o.hotel_id = p_hotel
     and o.business_date = p_date
     and l.voided and l.was_sent_when_voided
     and (l.parent_line_id is null or l.extra_kind is not null)
   order by l.voided_at;
$$;

grant execute on function app.pos_struck_after_kitchen(uuid, date) to pms_app;
