-- =============================================================================
-- 104 · A Main store, a Kitchen store and a Bar store at every hotel
-- =============================================================================
-- THE OWNER'S DECISION D17-3, 17 September (docs/briefs/decisions-2026-09-17.md):
-- the three places the stock plan named (S3) are created automatically at every
-- hotel, and at every new one. More can be added on Places and suppliers; one a
-- hotel does not use is switched off there.
--
-- Until now 094 seeded nothing, so no hotel had a store: stock could not be held
-- per place (the Store's phase 1A puts the stock already recorded in the Main
-- store, D17-2), and equipment could never "leave the store" (S12).
--
-- ONLY A HOTEL WITH NO STORE AT ALL GETS THEM. Every deploy replays every
-- migration (MEMORY 284). A hotel that renamed "Main store" to "Main godown", or
-- switched the Bar store off, still has places of kind `store` — so a replay adds
-- nothing and brings nothing back. Names are the owner's words, not invented data.
--
-- SECURITY DEFINER for the trigger's sake: `locations` is FORCE row level
-- security and a property being created is not yet among its creator's hotels.
-- Owned by the migrator, which holds BYPASSRLS on production since 068.
-- =============================================================================

create or replace function app.default_stores(p_hotel uuid)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_made int := 0;
begin
  if exists (select 1 from locations where hotel_id = p_hotel and kind = 'store') then
    return 0;
  end if;
  insert into locations (hotel_id, name, kind)
  values (p_hotel, 'Main store', 'store'),
         (p_hotel, 'Kitchen store', 'store'),
         (p_hotel, 'Bar store', 'store')
  on conflict (hotel_id, name) do nothing;
  get diagnostics v_made = row_count;
  return v_made;
end $fn$;

revoke all on function app.default_stores(uuid) from public;

comment on function app.default_stores(uuid) is
  'Creates Main, Kitchen and Bar store at a hotel that has no place of kind store '
  '(D17-3). A hotel that already has any store, renamed or switched off, is left '
  'as it is. Returns how many were made.';

-- every hotel that exists now
do $$
declare h record;
begin
  for h in select id from hotels loop
    perform app.default_stores(h.id);
  end loop;
end $$;

-- and every hotel created after
create or replace function app.default_stores_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform app.default_stores(new.id);
  return new;
end $fn$;

revoke all on function app.default_stores_for_new_property() from public;

drop trigger if exists hotels_default_stores on hotels;
create trigger hotels_default_stores
  after insert on hotels
  for each row execute function app.default_stores_for_new_property();
