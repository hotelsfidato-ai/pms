-- =============================================================================
-- EQUIPMENT — the register (phase 1B, docs/STOCK-AND-EQUIPMENT-PLAN.md)
-- =============================================================================
-- Refers to its migration by what it does — "the equipment register" — never
-- by its number: the master renumbers whichever of the Store and Equipment
-- merges second (plan § 7).
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here; what the APPLICATION may do is checked through its
-- grants, and row isolation through FORCE.
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  clerk uuid; elsewhere uuid;
  r101 uuid; r102 uuid; r_other uuid;
  lobby uuid; lobby_other uuid;
  sup uuid; sup_other uuid;
  cat uuid; cat_other uuid;
  tv uuid; kettles uuid; two uuid; lamp uuid;
  n int; v text; hist equipment_history;
begin
  h     := app.provision_property_unchecked('EQP','Equipment Test','Nowhere');
  other := app.provision_property_unchecked('EQQ','Equipment Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 102);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);
  select id into r101    from rooms where hotel_id = h     and number = '101';
  select id into r102    from rooms where hotel_id = h     and number = '102';
  select id into r_other from rooms where hotel_id = other and number = '201';

  insert into staff (email, full_name) values ('eq-clerk@fidato.in', 'Equipment Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('eq-elsewhere@fidato.in', 'Equipment Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'hotel_manager'), (elsewhere, other, 'gm');

  insert into locations (hotel_id, name, kind) values (h, 'Lobby', 'public_area')
  returning id into lobby;
  insert into locations (hotel_id, name, kind) values (other, 'Lobby', 'public_area')
  returning id into lobby_other;
  insert into suppliers (hotel_id, name) values (h, 'Solapur Electricals')
  returning id into sup;
  insert into suppliers (hotel_id, name) values (other, 'Solapur Electricals')
  returning id into sup_other;

  -- Who the history names: the person the API sets, exactly as withUser does.
  perform set_config('app.user_id', clerk::text, true);

  -- ---------- nothing ships ----------------------------------------------------
  select count(*) into n from equipment_categories where hotel_id = h;
  perform test.ok('equipment register','a new property has no categories', n = 0, n || ' arrived');
  select count(*) into n from equipment_items where hotel_id = h;
  perform test.ok('equipment register','a new property has no equipment', n = 0, n || ' arrived');
  perform test.ok('equipment register','the first tag a property is offered is EQ-0001',
    app.next_equipment_tag(h) = 'EQ-0001', app.next_equipment_tag(h));

  -- ---------- categories: one list per property, one name in any capitals ------
  insert into equipment_categories (hotel_id, name, created_by) values (h, 'Appliance', clerk)
  returning id into cat;
  insert into equipment_categories (hotel_id, name) values (other, 'Appliance')
  returning id into cat_other;
  perform test.raises('equipment register','"appliance " is the same category as "Appliance"',
    format($q$insert into equipment_categories (hotel_id, name) values (%L, 'appliance ')$q$, h),
    '23505');
  perform test.raises('equipment register','a category with no name is refused',
    format($q$insert into equipment_categories (hotel_id, name) values (%L, '  ')$q$, h), '23514');

  -- ---------- a tagged item ----------------------------------------------------
  insert into equipment_items
    (hotel_id, name, category_id, held_as, tag, room_id, supplier_id, purchase_date,
     warranty_ends, created_by)
  values (h, 'LED TV 43 inch', cat, 'tagged', 'EQ-0001', r101, sup, '2025-04-01',
          '2027-03-31', clerk)
  returning id into tv;

  select * into hist from equipment_history where item_id = tv order by id limit 1;
  perform test.ok('equipment register','adding an item records it: added, where, who',
    hist.kind = 'added' and hist.to_room_id = r101 and hist.done_by = clerk
    and hist.to_status = 'in_use' and hist.quantity = 1,
    coalesce(hist.kind, 'no history row'));

  perform test.ok('equipment register','a cost nobody typed stays NULL — never zero',
    (select unit_cost is null and amc_ends is null from equipment_items where id = tv));

  perform test.ok('equipment register','the next tag follows the highest EQ-number',
    app.next_equipment_tag(h) = 'EQ-0002', app.next_equipment_tag(h));

  perform test.raises('equipment register','a tag is unique at a property, in any capitals and spacing',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id)
              values (%L, 'Another TV', 'tagged', ' eq-0001', %L)$q$, h, r102), '23505');

  perform test.allows('equipment register','the same tag at ANOTHER property is its own',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id)
              values (%L, 'TV', 'tagged', 'EQ-0001', %L)$q$, other, r_other));

  perform test.raises('equipment register','a tagged item is one thing — a quantity of 2 is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, quantity, room_id)
              values (%L, 'Two TVs', 'tagged', 'EQ-0050', 2, %L)$q$, h, r102), '23514');
  perform test.raises('equipment register','a tagged item with no tag is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, room_id)
              values (%L, 'Fridge', 'tagged', %L)$q$, h, r102), '23514');
  perform test.raises('equipment register','a counted line carries no tag',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, quantity, room_id)
              values (%L, 'Kettles', 'counted', 'EQ-0051', 12, %L)$q$, h, r102), '23514');
  perform test.raises('equipment register','a counted line of nothing is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, quantity, room_id)
              values (%L, 'Kettles', 'counted', 0, %L)$q$, h, r102), '23514');

  -- ---------- a room or a place, exactly one, at this property ------------------
  perform test.raises('equipment register','an item nowhere is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag)
              values (%L, 'Sofa', 'tagged', 'EQ-0060')$q$, h), '23514');
  perform test.raises('equipment register','an item in a room AND a place is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, location_id)
              values (%L, 'Sofa', 'tagged', 'EQ-0061', %L, %L)$q$, h, r101, lobby), '23514');
  perform test.raises('equipment register','a room at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id)
              values (%L, 'Sofa', 'tagged', 'EQ-0062', %L)$q$, h, r_other), '23503');
  perform test.raises('equipment register','a place at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, location_id)
              values (%L, 'Sofa', 'tagged', 'EQ-0063', %L)$q$, h, lobby_other), '23514');
  perform test.raises('equipment register','a supplier at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, supplier_id)
              values (%L, 'Sofa', 'tagged', 'EQ-0064', %L, %L)$q$, h, r101, sup_other), '23514');
  perform test.raises('equipment register','a category at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, category_id)
              values (%L, 'Sofa', 'tagged', 'EQ-0065', %L, %L)$q$, h, r101, cat_other), '23503');

  -- ---------- figures that cannot be true --------------------------------------
  perform test.raises('equipment register','a negative cost is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, unit_cost)
              values (%L, 'Sofa', 'tagged', 'EQ-0066', %L, -1)$q$, h, r101), '23514');
  perform test.raises('equipment register','a warranty that ends before the purchase is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, purchase_date, warranty_ends)
              values (%L, 'Sofa', 'tagged', 'EQ-0067', %L, '2025-05-01', '2025-04-30')$q$, h, r101), '23514');
  perform test.raises('equipment register','an item cannot be added already retired',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, room_id, status,
                                           retired_at, retired_by, retire_reason)
              values (%L, 'Sofa', 'tagged', 'EQ-0068', %L, 'retired', now(), %L, 'x')$q$,
           h, r101, clerk), '23514');

  -- ---------- a move is recorded, not overwritten ------------------------------
  perform set_config('app.equipment_note', 'Lobby needed a screen', true);
  update equipment_items set room_id = null, location_id = lobby where id = tv;
  perform set_config('app.equipment_note', '', true);
  select * into hist from equipment_history where item_id = tv and kind = 'moved';
  perform test.ok('equipment register','a move records where it was, where it went, who and why',
    hist.from_room_id = r101 and hist.to_location_id = lobby and hist.from_location_id is null
    and hist.to_room_id is null and hist.done_by = clerk and hist.note = 'Lobby needed a screen',
    coalesce(hist.kind, 'no moved row'));

  update equipment_items set status = 'under_repair' where id = tv;
  perform test.ok('equipment register','under repair is recorded as a status change',
    exists (select 1 from equipment_history where item_id = tv and kind = 'status'
               and from_status = 'in_use' and to_status = 'under_repair'));

  update equipment_items set unit_cost = 32000 where id = tv;
  select changes -> 'unitCost' ->> 'to' into v
    from equipment_history where item_id = tv and kind = 'edited';
  perform test.ok('equipment register','an edited cost records what it was and what it became',
    v = '32000.00', coalesce(v, 'no edited row'));

  perform test.raises('equipment register','an item does not change property',
    format($q$update equipment_items set hotel_id = %L where id = %L$q$, other, tv), '23514');
  perform test.raises('equipment register','tagged or counted is decided when it is added',
    format($q$update equipment_items set held_as = 'counted', tag = null where id = %L$q$, tv), '23514');

  -- ---------- a counted line, and part of it moving ----------------------------
  insert into equipment_items (hotel_id, name, held_as, quantity, room_id, unit_cost, created_by)
  values (h, 'Electric kettle', 'counted', 12, r101, 1200, clerk)
  returning id into kettles;

  perform test.raises('equipment register','a count cannot be typed over — 11 over 12 loses a kettle',
    format($q$update equipment_items set quantity = 11 where id = %L$q$, kettles), '23514');

  insert into equipment_items
    (hotel_id, name, held_as, quantity, room_id, unit_cost, split_from, created_by)
  values (h, 'Electric kettle', 'counted', 2, r101, 1200, kettles, clerk)
  returning id into two;

  perform test.ok('equipment register','taking 2 of 12 leaves 10 on the line and 2 on a new one',
    (select quantity from equipment_items where id = kettles) = 10
    and (select quantity from equipment_items where id = two) = 2);
  perform test.ok('equipment register','a split is recorded on BOTH lines, each naming the other',
    exists (select 1 from equipment_history where item_id = kettles and kind = 'split'
               and quantity = 2 and related_item_id = two)
    and exists (select 1 from equipment_history where item_id = two and kind = 'split'
               and quantity = 2 and related_item_id = kettles));

  update equipment_items set room_id = r102 where id = two;
  perform test.ok('equipment register','the new line then moves, as its own recorded step',
    exists (select 1 from equipment_history where item_id = two and kind = 'moved'
               and from_room_id = r101 and to_room_id = r102));
  perform test.ok('equipment register','every kettle is still on a line — the lines add up to 12',
    (select sum(quantity) from equipment_items where id in (kettles, two)) = 12);

  perform test.raises('equipment register','taking all 10 of 10 is a move of the line, not a split',
    format($q$insert into equipment_items (hotel_id, name, held_as, quantity, room_id, split_from)
              values (%L, 'Electric kettle', 'counted', 10, %L, %L)$q$, h, r101, kettles), '23514');
  perform test.raises('equipment register','a split line starts where its line is',
    format($q$insert into equipment_items (hotel_id, name, held_as, quantity, room_id, split_from)
              values (%L, 'Electric kettle', 'counted', 1, %L, %L)$q$, h, r102, kettles), '23514');
  perform test.raises('equipment register','a tagged item cannot be split',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, location_id, split_from)
              values (%L, 'LED TV 43 inch', 'tagged', 'EQ-0070', %L, %L)$q$, h, lobby, tv), '23514');

  -- ---------- retiring ----------------------------------------------------------
  perform test.raises('equipment register','a request to retire is only ever on a tagged item',
    format($q$update equipment_items set retire_requested_at = now(), retire_requested_by = %L,
                     retire_reason = 'broken' where id = %L$q$, clerk, kettles), '23514');
  perform test.raises('equipment register','retiring with no reason is refused — who, when AND why',
    format($q$update equipment_items set status = 'retired', retired_at = now(), retired_by = %L
              where id = %L$q$, clerk, tv), '23514');

  update equipment_items
     set retire_requested_at = now(), retire_requested_by = clerk,
         retire_reason = 'Screen cracked, not worth repairing'
   where id = tv;
  perform test.ok('equipment register','a request to retire is recorded, and the item is not retired yet',
    exists (select 1 from equipment_history where item_id = tv and kind = 'retire_requested'
               and done_by = clerk)
    and (select status from equipment_items where id = tv) = 'under_repair');

  update equipment_items set status = 'retired', retired_at = now(), retired_by = clerk
   where id = tv;
  select * into hist from equipment_history where item_id = tv and kind = 'retired';
  perform test.ok('equipment register','retiring records who, why, and where it stood',
    hist.done_by = clerk and hist.note = 'Screen cracked, not worth repairing'
    and hist.from_location_id = lobby and hist.from_status = 'under_repair',
    coalesce(hist.kind, 'no retired row'));
  perform test.ok('equipment register','the request stays on the item beside the retirement',
    (select retire_requested_by = clerk and retired_by = clerk from equipment_items where id = tv));

  perform test.raises('equipment register','a retired item is kept exactly as it was retired',
    format($q$update equipment_items set name = 'Renamed' where id = %L$q$, tv), '23514');
  perform test.raises('equipment register','a retired item does not move',
    format($q$update equipment_items set location_id = null, room_id = %L where id = %L$q$, r101, tv), '23514');

  -- A request that is declined is recorded too.
  insert into equipment_items (hotel_id, name, held_as, tag, room_id, created_by)
  values (h, 'Floor lamp', 'tagged', 'EQ-0002', r102, clerk) returning id into lamp;
  update equipment_items set retire_requested_at = now(), retire_requested_by = clerk,
         retire_reason = 'Old' where id = lamp;
  update equipment_items set retire_requested_at = null, retire_requested_by = null,
         retire_reason = null where id = lamp;
  perform test.ok('equipment register','a declined retirement is recorded',
    exists (select 1 from equipment_history where item_id = lamp and kind = 'retire_declined'));

  -- ---------- the history cannot be rewritten ----------------------------------
  perform test.raises('equipment register','the history cannot be edited',
    format($q$update equipment_history set note = 'nothing happened' where item_id = %L$q$, tv), 'P0001');
  perform test.raises('equipment register','the history cannot be deleted',
    format($q$delete from equipment_history where item_id = %L$q$, tv), 'P0001');

  -- ---------- the next tag never truncates ------------------------------------
  insert into equipment_items (hotel_id, name, held_as, tag, room_id)
  values (h, 'Printed label, not ours', 'tagged', 'LOBBY-TV-2', r102),
         (h, 'Chest freezer', 'tagged', 'eq-9999', r102);
  perform test.ok('equipment register','a typed label neither blocks nor bends the numbers',
    app.next_equipment_tag(h) = 'EQ-10000', app.next_equipment_tag(h));

  -- ---------- what the application may do -------------------------------------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and privilege_type = 'DELETE'
     and table_name in ('equipment_items', 'equipment_categories', 'equipment_history');
  perform test.ok('equipment register','the application cannot delete equipment, a category or its history',
    n = 0, n || ' delete grants');
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name = 'equipment_history'
     and privilege_type in ('INSERT', 'UPDATE');
  perform test.ok('equipment register','the application can only READ the history — the triggers write it',
    n = 0, n || ' write grants');
  select count(*) into n from pg_class
   where relname in ('equipment_items', 'equipment_categories', 'equipment_history')
     and relrowsecurity and relforcerowsecurity;
  perform test.ok('equipment register','all three tables force row-level security', n = 3, n || ' of 3');

  -- ---------- and the fixtures go ---------------------------------------------
  perform set_config('app.equipment_note', '', true);
  alter table equipment_history disable trigger equipment_history_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table equipment_history enable trigger equipment_history_append_only;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  update staff set is_active = false where id in (clerk, elsewhere);

  select count(*) into n from hotels where code in ('EQP', 'EQQ');
  perform test.ok('equipment register','the fixtures do not outlive the test', n = 0,
    n || ' left behind');
end $$;

-- Back to the suite's own signed-in person for anything after this file.
select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
