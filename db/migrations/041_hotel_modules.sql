-- =============================================================================
-- 041 — a hotel says which modules it has
-- =============================================================================
-- Not every property has a restaurant. Some have a banquet hall instead, some
-- have neither. Today the POS navigation is present at every hotel and the till
-- answers for all of them, so a property with no kitchen shows staff a menu
-- screen that will never have items in it.
--
-- A row per hotel per module. ABSENT MEANS ENABLED for `pos`, and that is
-- deliberate: this migration must not turn the till off at the one property
-- already using it. Turning something off is an act somebody performs, never a
-- side effect of deploying.
--
-- HIDING A SCREEN IS NOT DISABLING IT. The navigation stops showing the module
-- and the API refuses its routes, independently. A hidden screen whose endpoint
-- still answers is a screen anybody can reach by typing the URL, and that is
-- the whole shape of Rule 6.
-- =============================================================================

create table if not exists hotel_modules (
  hotel_id   uuid not null references hotels(id) on delete cascade,
  module     text not null,
  is_enabled boolean not null default true,

  -- Who turned it off, and when. A module that quietly stopped working is a
  -- support call; a module somebody switched off on a date is an answer.
  changed_by uuid references staff(id),
  changed_at timestamptz not null default now(),

  primary key (hotel_id, module),

  constraint hotel_modules_known check (module in ('pos', 'banquet'))
);

comment on table hotel_modules is
  'Which modules a property has. NO ROW MEANS ENABLED for pos — the default '
  'must never be "off", or deploying this would silently close the till at a '
  'property that was using it.';

alter table hotel_modules enable row level security;
alter table hotel_modules force  row level security;

drop policy if exists hotel_modules_isolation on hotel_modules;
create policy hotel_modules_isolation on hotel_modules
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- The question every guard asks
-- -----------------------------------------------------------------------------
-- One definition, so the navigation and the API cannot disagree about whether
-- a module is on. `banquet` defaults OFF because nothing implements it yet —
-- a property should not see a half-built module because nobody wrote a row.
-- -----------------------------------------------------------------------------
create or replace function app.module_enabled(p_hotel uuid, p_module text)
returns boolean language sql stable as $$
  select coalesce(
    (select is_enabled from hotel_modules
      where hotel_id = p_hotel and module = p_module),
    p_module = 'pos'
  );
$$;

comment on function app.module_enabled(uuid, text) is
  'True when the property has this module. Absent rows mean ON for pos and OFF '
  'for banquet: pos is live somewhere already, banquet is not built.';

grant select, insert, update on hotel_modules to pms_app;
grant execute on function app.module_enabled(uuid, text) to pms_app;
