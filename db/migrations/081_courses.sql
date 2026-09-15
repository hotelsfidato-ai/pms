-- =============================================================================
-- 081 · Which course a dish belongs to
-- =============================================================================
-- Starters before mains. Obvious in a dining room and invisible to this system
-- until now: the pass shows a flat list of dishes ordered by when each was
-- rung up, so a table's main course can sit under a lamp while its starters
-- are still being cooked.
--
-- ⚠ NOT `sort_order`, AND THE MENU ITSELF SAYS WHY.
--
-- Reusing the category's `sort_order` looks free and is wrong. Akkalkot's
-- categories sort:
--
--     0  Starters      1  Main course      2  Beverages      3  Desserts
--
-- Beverages sits BETWEEN the mains and the desserts, because that is a
-- sensible order to read a menu in. It is not a course, and a pass that fired
-- drinks after the mains and before the puddings would be wrong every single
-- service. `sort_order` answers "where does this print on the card"; this
-- column answers "when does it reach the table". Two questions, two columns.
--
-- ⚠ NULL MEANS NOT SEQUENCED, and unlike 079 that is the SAME as "nobody has
-- said" — deliberately.
--
-- For a preparation time the difference mattered: zero would have been a lie
-- about the food. Here an unsequenced dish behaves identically whether nobody
-- got round to it or somebody decided a lime soda has no place in a sequence.
-- Either way it is cooked when it is cooked and carried when it is ready. So
-- one state, not two, and this comment rather than a column nobody would keep
-- accurate.
--
-- IT IS ADVISORY. Nothing here refuses to cook a main before a starter — a
-- kitchen that has to fight its own screen turns the screen off. It groups,
-- it orders, and it lets a chef see what is coming.
-- =============================================================================


alter table pos_menu_categories add column if not exists course integer;
alter table pos_menu_items      add column if not exists course integer;

-- 1..9. Nine is a tasting menu and generous; the bound exists to catch a
-- year typed into the wrong box, not to have an opinion about menus.
alter table pos_menu_categories drop constraint if exists pos_menu_categories_course_sane;
alter table pos_menu_categories
  add constraint pos_menu_categories_course_sane
  check (course is null or (course >= 1 and course <= 9));

alter table pos_menu_items drop constraint if exists pos_menu_items_course_sane;
alter table pos_menu_items
  add constraint pos_menu_items_course_sane
  check (course is null or (course >= 1 and course <= 9));

comment on column pos_menu_categories.course is
  'Which course everything in this category belongs to. NULL means not part '
  'of a sequence — a drink, or nothing anybody has decided. NOT sort_order, '
  'which is where it prints on the card.';

comment on column pos_menu_items.course is
  'This dish''s course, overriding its category. NULL falls back.';


-- -----------------------------------------------------------------------------
-- The one definition
-- -----------------------------------------------------------------------------
-- Same shape as `app.prep_minutes`, on purpose. Two fallbacks that behave
-- differently would be two rules for one idea, and somebody would eventually
-- write a third.
create or replace function app.course_of(p_item uuid)
returns integer
language sql
stable
as $$
  select coalesce(i.course, c.course)
    from pos_menu_items i
    join pos_menu_categories c on c.id = i.category_id
   where i.id = p_item
$$;

comment on function app.course_of(uuid) is
  'Which course a dish belongs to: its own, else its category''s, else NULL '
  'for an unsequenced dish. The only place that fallback is written.';

grant execute on function app.course_of(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- What a table is waiting for
-- -----------------------------------------------------------------------------
-- The pass groups by table; this is what it groups BY. One row per course
-- still live on an order, with enough to draw it.
--
-- ⚠ `served` IS EXCLUDED, and voided lines with it. A course that has reached
-- the table is not something the kitchen is still holding, and leaving it here
-- would make every table look permanently busy by the end of a service.
--
-- The course a table is actually waiting on is the LOWEST unfinished one, and
-- callers get that by taking the first row — which is why the ordering is part
-- of the function rather than left to whoever reads it. An unsequenced dish
-- sorts last: it is not blocking anything and it is not waiting for anything.
create or replace function app.pos_order_courses(p_order uuid)
returns table (
  course     integer,
  dishes     integer,
  waiting    integer,   -- sent, not yet on the fire
  cooking    integer,
  ready      integer,   -- ⚠ sitting at the pass
  sent_at    timestamptz
)
language sql
stable
as $$
  select app.course_of(l.item_id) as course,
         count(*)::int,
         count(*) filter (where l.kot_status = 'sent')::int,
         count(*) filter (where l.kot_status = 'preparing')::int,
         count(*) filter (where l.kot_status = 'ready')::int,
         min(l.kot_sent_at)
    from pos_order_lines l
   where l.order_id = p_order
     and not l.voided
     and l.kot_status in ('sent', 'preparing', 'ready')
     and l.parent_line_id is null
     and l.item_id is not null
   group by app.course_of(l.item_id)
   -- NULLS LAST: an unsequenced dish is not course zero and must not sort
   -- ahead of the starters.
   --
   -- ⚠ THIS CLAUSE IS INTENT, NOT MECHANISM. Postgres already defaults ASC to
   -- NULLS LAST, and removing it changes nothing — checked. It is written out
   -- because the reader cannot know that from here, and because flipping this
   -- to DESC one day WOULD change it silently.
   --
   -- What the suite actually guards against is the plausible wrong fix:
   -- `coalesce(app.course_of(...), 0)`, tidying the null away. That fires the
   -- drinks before the starters on every table, and two assertions catch it.
   order by app.course_of(l.item_id) asc nulls last
$$;

comment on function app.pos_order_courses(uuid) is
  'The courses still with the kitchen for one order, lowest first and '
  'unsequenced last. Served and voided lines are excluded — a course that '
  'reached the table is not something the kitchen is holding.';

grant execute on function app.pos_order_courses(uuid) to pms_app;
