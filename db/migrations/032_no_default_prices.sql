-- =============================================================================
-- 032_no_default_prices.sql — the system ships no price
-- =============================================================================
-- `room_type_templates` carried a `default_rate`, and provision_property()
-- copied it straight onto every new property's room types:
--
--     insert into room_types (..., base_rate, ...)
--     select ..., t.default_rate, ...
--
-- So a property created through the admin console arrived priced:
--
--     Standard  ₹3,500      Executive ₹6,000
--     Deluxe    ₹4,800      Suite     ₹7,500
--
-- Those numbers were invented when the templates were written. Nobody at
-- Fidato chose them. They would have appeared on the tape chart, defaulted a
-- walk-in's tariff, and reached a guest's folio — looking exactly like the
-- hotel's own rates, because everything else on the screen is.
--
-- The group's instruction is plain: prices are not fixed, the team updates
-- them, and nothing is standard across properties. Rooms are added by the
-- person creating the property, and so are the rates.
--
-- The POS menu already worked this way — 028 ships no dish and no price, and
-- says so. This is the same rule applied to the thing that was already
-- breaking it.
--
-- A NULL RATE IS THE HONEST STATE.
--
-- Not zero. Zero is a claim — "this room is free" — and it is a claim that
-- would post a zero-value room charge at the night audit and quietly halve
-- an ADR. A dash is an honest answer; a zero is not.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The template describes the ROOM, not its price
-- -----------------------------------------------------------------------------
-- The column goes rather than being nulled, so nothing can quietly start
-- reading it again. Occupancy, name and code are genuinely standard across a
-- group of city hotels; a tariff is not.
-- -----------------------------------------------------------------------------

alter table room_type_templates drop column if exists default_rate;


-- -----------------------------------------------------------------------------
-- A room type may have no rate yet
-- -----------------------------------------------------------------------------
alter table room_types alter column base_rate drop not null;

-- The check has to tolerate the null it now permits. `>= 0` is unknown for
-- null, which passes a CHECK — but stating it plainly beats relying on
-- three-valued logic that the next reader has to re-derive.
alter table room_types drop constraint if exists room_types_rate_positive;
alter table room_types drop constraint if exists room_types_rate_sane;
alter table room_types
  add constraint room_types_rate_sane
  check (base_rate is null or base_rate >= 0);

comment on column room_types.base_rate is
  'The rack rate, entered by the hotel. NULL until somebody sets it — this '
  'system ships no price, and a zero would be a claim that the room is free.';


-- -----------------------------------------------------------------------------
-- Provisioning clones the catalogue and no longer prices it
-- -----------------------------------------------------------------------------
-- Taken from 014's definition verbatim, with ONE line changed. The first
-- attempt at this rewrote the body from memory and dropped
-- `on conflict (hotel_id, fin_year) do nothing` from the invoice series
-- insert — which mattered, because 025 also opens a series from a trigger on
-- `hotels`. Provisioning died on a duplicate key at the very first fixture.
--
-- When the point of a change is to remove one thing, remove one thing.
create or replace function app.provision_property_unchecked(
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
  perform app.require_group_admin();

  insert into hotels (code, name, city, state, gstin, timezone)
  values (upper(p_code), p_name, p_city, p_state, p_gstin, p_timezone)
  returning id into v_hotel_id;

  /* base_rate is deliberately absent from this column list. The room types
     arrive named and sized; the hotel prices them. */
  insert into room_types (hotel_id, code, name, base_occupancy,
                          max_occupancy, sort_order)
  select v_hotel_id, t.code, t.name, t.base_occupancy,
         t.max_occupancy, t.sort_order
    from room_type_templates t
   where t.template_set = p_template_set;

  get diagnostics v_types = row_count;

  if v_types = 0 then
    raise exception 'No room type templates found for set "%"', p_template_set
      using hint = 'Check room_type_templates, or pass a different p_template_set.';
  end if;

  -- S1: without this the property cannot issue its first invoice.
  -- `on conflict` because 025 opens one from a trigger on hotels as well.
  insert into invoice_series (hotel_id, fin_year, prefix, next_number)
  values (v_hotel_id, app.current_fin_year(), upper(p_code), 1)
  on conflict (hotel_id, fin_year) do nothing;

  raise notice 'Provisioned % (%) with % room types and no prices.',
               p_name, upper(p_code), v_types;
  return v_hotel_id;
end
$$;

comment on function app.provision_property_unchecked(text,text,text,text,text,text,text) is
  'Creates a property, its room type catalogue and its invoice series. NO '
  'authorisation — for migrations, the loader and the suite. Prices nothing: '
  'the hotel enters its own rates, and its own rooms.';


-- -----------------------------------------------------------------------------
-- The demo property keeps its calibrated rates
-- -----------------------------------------------------------------------------
-- 5EL's figures reconcile to a real eZee export — ADR ₹3,178.63, room revenue
-- ₹4,19,578.76 — and those come from `reservations.agreed_rate`, not from
-- this column. But the tape chart shows a rack rate per type, and blanking
-- the demo's would make a calibrated fixture look unconfigured.
--
-- The loader already sets them and always did — `RACK` in load-demo.ts, with
-- Superior at 4099 and Deluxe at 3699, alongside the invented guest names
-- where invented numbers belong. Nothing had to change there.
--
-- I added a second update setting them anyway, without checking, and it
-- overwrote Deluxe with 4200. Removed. **Look at what a file already does
-- before adding the thing you assume is missing.**
-- -----------------------------------------------------------------------------
