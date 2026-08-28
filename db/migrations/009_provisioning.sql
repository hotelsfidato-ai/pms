-- =============================================================================
-- 009_provisioning.sql — "add a new property from the admin panel"
-- =============================================================================
-- This is the 90/10 idea, implemented.
--
-- Most of what defines a property is identical across the group: the room type
-- catalogue, the POS outlets, the stock list, the housekeeping task list, the
-- charge categories, the GST bands. What is actually unique is small — a name,
-- a city, a GSTIN, a set of room numbers, and the rates.
--
-- So: keep the 90% as TEMPLATES at group level, and provision a new property by
-- CLONING them. One function call. No DDL, no migration, no deploy, no restart,
-- and the React app never knows a seventh or eighth property appeared.
--
-- WHY CLONE INSTEAD OF POINTING AT THE TEMPLATE:
--   Because a property must be able to diverge. Agra renames "Deluxe" to
--   "Deluxe Garden View" and Pune adds a room type the others do not have.
--   If they shared a live row, editing one would edit all seven — which is
--   exactly the bug that makes people give up and build separate tables.
--
--   Clone-on-create gives you a common starting point AND independence after.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- room_type_templates — the group's standard catalogue. GROUP-LEVEL.
-- -----------------------------------------------------------------------------
create table if not exists room_type_templates (
  id          uuid primary key default gen_random_uuid(),
  -- Lets you keep more than one blueprint: 'standard' for city hotels,
  -- 'resort' for the leisure properties. provision_property() picks a set.
  template_set text not null default 'standard',
  code        text not null,
  name        text not null,
  base_occupancy smallint not null default 2,
  max_occupancy  smallint not null default 3,
  default_rate   numeric(12,2) not null,
  sort_order     smallint not null default 0,

  unique (template_set, code)
);

insert into room_type_templates (template_set, code, name, base_occupancy, max_occupancy, default_rate, sort_order) values
  ('standard', 'STD', 'Standard',       2, 3, 3500.00, 1),
  ('standard', 'DLX', 'Deluxe',         2, 3, 4800.00, 2),
  ('standard', 'EXE', 'Executive',      2, 3, 6000.00, 3),
  ('standard', 'STE', 'Suite',          2, 4, 7500.00, 4),
  ('resort',   'CTG', 'Cottage',        2, 4, 6500.00, 1),
  ('resort',   'VIL', 'Villa',          2, 6, 12000.00, 2)
on conflict (template_set, code) do nothing;


-- -----------------------------------------------------------------------------
-- app.provision_property() — the admin panel calls exactly this.
-- -----------------------------------------------------------------------------
-- Takes the 10% that is genuinely unique. Clones the 90% from templates.
-- Runs in one transaction: either the whole property exists, or none of it does.
--
--   select app.provision_property(
--     p_code         => 'FH08',
--     p_name         => 'Fidato Residency Nashik',
--     p_city         => 'Nashik',
--     p_state        => 'Maharashtra',
--     p_gstin        => '27AAAAA0000A1Z5',
--     p_template_set => 'standard'
--   );
--
-- Returns the new hotel's id. That is the entire onboarding.
-- -----------------------------------------------------------------------------
-- ⚠ THIS DEFINITION IS SUPERSEDED BY 010_roles.sql, which re-creates the same
--   function with an `app.require_group_admin()` check at the top. 010 runs
--   later and therefore wins.
--
--   Editing the body below alone changes nothing on a fresh install — the
--   change is silently overwritten. Make the edit in 010, or in both.
--   Between 009 and 010 running, provisioning is open to any active staff
--   member; do not stop a migration run in that gap.
create or replace function app.provision_property(
  p_code          text,
  p_name          text,
  p_city          text,
  p_state         text default null,
  p_gstin         text default null,
  p_template_set  text default 'standard',
  p_timezone      text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
as $$
declare
  v_hotel_id uuid;
  v_types    integer;
begin
  -- ---- the 10%: what is actually unique to this property -------------------
  insert into hotels (code, name, city, state, gstin, timezone)
  values (upper(p_code), p_name, p_city, p_state, p_gstin, p_timezone)
  returning id into v_hotel_id;

  -- ---- the 90%: cloned from the group templates ----------------------------
  insert into room_types (hotel_id, code, name, base_occupancy,
                          max_occupancy, base_rate, sort_order)
  select v_hotel_id, t.code, t.name, t.base_occupancy,
         t.max_occupancy, t.default_rate, t.sort_order
    from room_type_templates t
   where t.template_set = p_template_set;

  get diagnostics v_types = row_count;

  if v_types = 0 then
    raise exception 'No room type templates found for set "%"', p_template_set
      using hint = 'Check room_type_templates, or pass a different p_template_set.';
  end if;

  -- ---- EXTENSION POINTS ----------------------------------------------------
  -- As each module lands, add its clone step here and property onboarding
  -- keeps working unchanged. This is the whole benefit of one shared schema:
  -- new modules extend provisioning, they never multiply it.
  --
  --   phase 5  housekeeping : insert into hk_task_templates    -> hk_tasks
  --   phase 6  POS          : insert into pos_outlet_templates -> pos_outlets
  --                           insert into pos_menu_templates   -> pos_menu_items
  --   phase 7  inventory    : insert into stock_item_templates -> stock_items
  --   phase 8  rates        : insert into rate_plan_templates  -> rate_plans
  -- --------------------------------------------------------------------------

  raise notice 'Provisioned % (%) with % room types.', p_name, upper(p_code), v_types;

  return v_hotel_id;
end
$$;


-- -----------------------------------------------------------------------------
-- app.bulk_create_rooms() — the other half of the 10%.
-- -----------------------------------------------------------------------------
-- Room numbers are the part that genuinely differs per property and cannot be
-- templated. This turns "floor 1 has 101-118, all Standard" into one call.
--
--   select app.bulk_create_rooms('<hotel-id>', 'STD', 1, 101, 118);
--   select app.bulk_create_rooms('<hotel-id>', 'DLX', 2, 201, 214);
--
-- Returns how many rooms it created. Safe to re-run: existing numbers are
-- skipped rather than erroring, so a partially-entered floor can be topped up.
-- -----------------------------------------------------------------------------
create or replace function app.bulk_create_rooms(
  p_hotel_id       uuid,
  p_room_type_code text,
  p_floor          smallint,
  p_from           integer,
  p_to             integer
)
returns integer
language plpgsql
as $$
declare
  v_type_id uuid;
  v_created integer;
begin
  if p_to < p_from then
    raise exception 'Room range % to % runs backwards.', p_from, p_to;
  end if;

  select id into v_type_id
    from room_types
   where hotel_id = p_hotel_id and code = upper(p_room_type_code);

  if v_type_id is null then
    raise exception 'Hotel % has no room type "%".', p_hotel_id, p_room_type_code
      using hint = 'Provision the property first, or check the room type code.';
  end if;

  insert into rooms (hotel_id, room_type_id, number, floor)
  select p_hotel_id, v_type_id, n::text, p_floor
    from generate_series(p_from, p_to) as n
  on conflict (hotel_id, number) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end
$$;


-- =============================================================================
-- ONBOARDING A PROPERTY, START TO FINISH
-- =============================================================================
-- This is what the admin panel does. Four calls, no DDL, no deploy.
--
--   begin;
--
--   select app.provision_property(
--     'FH08', 'Fidato Residency Nashik', 'Nashik',
--     'Maharashtra', '27AAAAA0000A1Z5'
--   ) as hotel_id;  \gset
--
--   select app.bulk_create_rooms(:'hotel_id', 'STD', 1, 101, 118);
--   select app.bulk_create_rooms(:'hotel_id', 'DLX', 2, 201, 212);
--   select app.bulk_create_rooms(:'hotel_id', 'STE', 3, 301, 304);
--
--   insert into staff_hotels (staff_id, hotel_id, role)
--   select id, :'hotel_id', 'gm' from staff where email = 'gm.nashik@fidato.in';
--
--   commit;
--
-- The property is now live. It appears on the group dashboard on the next
-- refresh, its GM can sign in immediately, and NOTHING in the React app,
-- the schema, or the deployment changed.
--
-- Compare with the per-property-tables approach, where this same operation
-- means running DDL from a web request, replaying every migration against the
-- new tables, and regenerating the UNION that the group dashboard depends on.
-- =============================================================================
