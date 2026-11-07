-- The pictures A16-18 to A16-20 (Group reports, the Group rate change) need more
-- than one property. Loaded into the demo database before shooting them, as the
-- superuser: Shimla (a Deluxe, priced; Himachal Pradesh) and Agra (no Deluxe;
-- Uttar Pradesh). Demo GSTINs, not real. The test revenue manager also works at
-- Shimla. Re-runnable. NEVER on the live system.
insert into hotels (code, name, city, state, gstin, business_date)
values ('SHI', 'Fidato Shimla', 'Shimla', 'HP', '02AAAAA0000A1Z5', (select business_date from hotels where code = '5EL')),
       ('AGR', 'Fidato Agra', 'Agra', 'UP', '09AAAAA0000A1Z5', (select business_date from hotels where code = '5EL'))
on conflict (code) do nothing;

insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy, sort_order)
select h.id, t.code, t.name, 2, 3, t.n from hotels h
  join (values ('SHI', 'DLX', 'Deluxe', 1), ('SHI', 'STE', 'Suite', 2), ('AGR', 'STD', 'Standard', 1)) t(hotel, code, name, n)
    on t.hotel = h.code
where not exists (select 1 from room_types r where r.hotel_id = h.id and r.code = t.code);

select app.bulk_create_rooms((select id from hotels where code = 'SHI'), 'DLX', 1::smallint, 101, 104)
 where not exists (select 1 from rooms where hotel_id = (select id from hotels where code = 'SHI'));
select app.bulk_create_rooms((select id from hotels where code = 'SHI'), 'STE', 2::smallint, 201, 202)
 where (select count(*) from rooms where hotel_id = (select id from hotels where code = 'SHI')) = 4;
select app.bulk_create_rooms((select id from hotels where code = 'AGR'), 'STD', 1::smallint, 1, 6)
 where not exists (select 1 from rooms where hotel_id = (select id from hotels where code = 'AGR'));

select app.set_base_price(h.id, rt.id, date_trunc('month', h.business_date)::date, null, p.price, null, null)
  from hotels h join room_types rt on rt.hotel_id = h.id
  join (values ('SHI', 'DLX', 4200), ('SHI', 'STE', 6500), ('AGR', 'STD', 2800)) p(hotel, code, price)
    on p.hotel = h.code and p.code = rt.code;

insert into staff_hotels (staff_id, hotel_id, role)
select s.id, h.id, 'revenue_manager' from staff s, hotels h
 where s.email = 'dev-revenue@fidato.in' and h.code = 'SHI'
on conflict (staff_id, hotel_id) do update set role = excluded.role;
