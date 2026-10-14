-- =============================================================================
-- 224 · The Bar role (the owner's D27-324 (2), 14 October)
-- =============================================================================
-- "A separate Bar role: the waiter's rights (orders, KOT, bills, payment,
-- discount up to 10% with a reason, closing the restaurant day), but it opens
-- on the bar and sees and orders only the bar's menu sections; its KOTs go to
-- the bar printer."
--
-- WHAT THE ROLE MAY DO lives in api/src/permissions.ts and roleGate.ts, as
-- every role's does. This file does three things:
--
-- (1) `bar` joins app.assignable_roles(), the one list a person's role is
--     checked against (078). Who may GIVE it follows by itself: grantable_roles
--     (152) is this list less owner and admin for anybody but the owner, so
--     whoever gives the waiter's role gives this one. api/test/roles.test.ts
--     fails if this list and the website's differ.
--
-- (2) WHAT "THE BAR'S" MEANS: a dish whose KOT is the Bar kind - its section's
--     own kind, else its tax heading's (Bar and Alcohol to the Bar), exactly as
--     app.pos_kot_kind_for (211) routes it. That is the one link a dish has to
--     the bar; nothing new is stored. So a Bar person's KOTs print where the
--     Bar kind prints, by construction.
--
-- (3) THE DATABASE REFUSES THE REST: a Bar person cannot put a dish that
--     prints anywhere but the bar on a bill, nor raise the count of one. The
--     till says why first (api/src/modules/pos/till.ts); this is the guarantee
--     behind it. Everybody else, a till's service account and a group
--     administrator included, is unchanged.
--
-- Re-runnable: create or replace with unchanged signatures, the trigger
-- dropped and made again.
--
-- ⚠ REPLAY: 078 and 093 put back a narrower app.assignable_roles() when every
-- migration is replayed, until this file runs again. staff_hotels' constraint
-- is checked on a write, not re-validated (078 re-adds it only when it is not
-- already the function's), so a `bar` row survives the replay as a
-- revenue_manager row always has. db/tests/rerun.sh gives every role a person
-- and replays over them.
-- =============================================================================

-- (1) ------------------------------------------------------------------------
create or replace function app.assignable_roles()
returns text[]
language sql
immutable
as $fn$
  select array[
    'owner',            -- unrestricted; sole authority over roles and settings
    'admin',            -- runs the platform day to day, including accounts
    'gm',               -- the whole book at their properties; approves; sets prices
    'hotel_manager',    -- one property, below the GM
    'revenue_manager',  -- prices and restrictions; no money taken, no guests, no staff (093)
    'front_desk',       -- shown as Reception
    'housekeeping',
    'kitchen_manager',
    'chef',
    'pos',              -- shown as Waiter (D27-324); also an outside till's account
    'bar',              -- the waiter's rights on the bar's dishes only (224)
    'stores',           -- shown as Inventory Manager
    'finance',          -- shown as Accountant
    'read_only'         -- shown as Viewer
  ]
$fn$;

comment on function app.assignable_roles() is
  'Every role a person may be given. The one authority: staff grants are '
  'checked against it (078) and the interface is held equal to it by '
  'api/test/roles.test.ts. revenue_manager added 16 September 2026 (093), '
  'bar 14 October 2026 (224).';

-- (2) ------------------------------------------------------------------------
create or replace function app.pos_dish_at_bar(p_hotel uuid, p_item uuid)
returns boolean
language sql stable
as $$
  select exists (select 1 from pos_kot_kinds k
                  where k.id = app.pos_kot_kind_for(p_hotel, p_item) and k.role = 'bar');
$$;

comment on function app.pos_dish_at_bar(uuid, uuid) is
  'D27-324: this dish prints on the Bar KOT - its section''s kind, else its '
  'tax heading''s (app.pos_kot_kind_for, 211). What a Bar person may order.';

/* The caller is a Bar person at this hotel. A group administrator never is. */
create or replace function app.pos_bar_only(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select not app.is_group_admin() and exists (
    select 1 from staff_hotels sh
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and sh.role = 'bar');
$$;

comment on function app.pos_bar_only(uuid) is
  'D27-324: the caller''s role at this hotel is Bar, so they see and order '
  'only the dishes that print on the Bar KOT (app.pos_dish_at_bar).';

revoke all on function app.pos_bar_only(uuid) from public;
grant execute on function app.pos_bar_only(uuid) to pms_app;

-- (3) ------------------------------------------------------------------------
create or replace function app.pos_bar_orders_from_the_bar()
returns trigger
language plpgsql
as $$
begin
  if new.item_id is not null
     and (tg_op = 'INSERT' or new.qty > old.qty)
     and app.pos_bar_only(new.hotel_id)
     and not app.pos_dish_at_bar(new.hotel_id, new.item_id) then
    raise exception 'The bar orders only the bar''s dishes. A waiter orders %.', new.name
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists pos_order_lines_bar_only on pos_order_lines;
create trigger pos_order_lines_bar_only
  before insert or update of qty on pos_order_lines
  for each row execute function app.pos_bar_orders_from_the_bar();
