-- =============================================================================
-- SHARED — tables no single service owns
-- =============================================================================
-- One file per service lives beside this one. These tables are used by several
-- services at once and were built by the master chat, so their checks are here
-- rather than in any one service's file (docs/STOCK-AND-EQUIPMENT-PLAN.md § 2).
-- Builds its own property and removes it.
-- =============================================================================


-- =============================================================================
-- SUPPLIERS AND LOCATIONS (094)
-- =============================================================================
do $$
declare
  h uuid; other uuid; n int;
begin
  h     := app.provision_property_unchecked('SUP','Suppliers Test','Nowhere');
  other := app.provision_property_unchecked('SUQ','Suppliers Other','Nowhere');

  -- ---------- nothing ships ----------
  select count(*) into n from suppliers where hotel_id = h;
  perform test.ok('suppliers and locations','a new property has no suppliers', n = 0, n || ' arrived');
  select count(*) into n from locations where hotel_id = h;
  perform test.ok('suppliers and locations',
    'a new property has no locations — not even the three the owner chose', n = 0, n || ' arrived');

  -- ---------- a supplier ----------
  insert into suppliers (hotel_id, name, phone, gstin)
  values (h, 'Akkalkot Oil Traders', '+91 00000 00000', '27ABCDE1234F1Z5');
  perform test.ok('suppliers and locations','a supplier with a valid GSTIN is accepted',
    (select count(*) from suppliers where hotel_id = h) = 1);

  perform test.raises('suppliers and locations','a malformed GSTIN is refused',
    format($q$insert into suppliers (hotel_id, name, gstin)
              values (%L, 'Wrong GST Co', 'NOT-A-GSTIN')$q$, h), '23514');

  perform test.raises('suppliers and locations','a supplier with no name is refused',
    format($q$insert into suppliers (hotel_id, name) values (%L, '   ')$q$, h), '23514');

  perform test.raises('suppliers and locations','the same supplier twice at one property is refused',
    format($q$insert into suppliers (hotel_id, name) values (%L, 'Akkalkot Oil Traders')$q$, h),
    '23505');

  insert into suppliers (hotel_id, name) values (other, 'Akkalkot Oil Traders');
  perform test.ok('suppliers and locations','the same name at ANOTHER property is its own supplier',
    (select count(*) from suppliers where name = 'Akkalkot Oil Traders' and hotel_id in (h, other)) = 2);

  -- ---------- locations ----------
  insert into locations (hotel_id, name, kind) values
    (h, 'Main store', 'store'), (h, 'Kitchen store', 'store'), (h, 'Lobby', 'public_area');
  perform test.ok('suppliers and locations','places of each kind can be added',
    (select count(*) from locations where hotel_id = h) = 3);

  perform test.raises('suppliers and locations','a kind the hotel does not have is refused',
    format($q$insert into locations (hotel_id, name, kind) values (%L, 'Garage', 'car_park')$q$, h),
    '23514');

  perform test.raises('suppliers and locations','two places with one name at a property are refused',
    format($q$insert into locations (hotel_id, name, kind) values (%L, 'Lobby', 'office')$q$, h),
    '23505');

  -- ---------- neither can be deleted by the application ----------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name in ('suppliers', 'locations')
     and privilege_type = 'DELETE';
  perform test.ok('suppliers and locations',
    'the application cannot delete a supplier or a place — it switches them off', n = 0,
    n || ' delete grants');

  -- ---------- and the fixtures go ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('SUP', 'SUQ');
  perform test.ok('suppliers and locations','the fixtures do not outlive the test', n = 0,
    n || ' left behind');
end $$;
