-- =============================================================================
-- 239 · Bar stock as a switch for each hotel (the owner's D27-367, 26 October)
-- =============================================================================
-- The owner: "make the bar a toggle menu option where we toggle to use it".
-- A `bar_stock` module, switched in Admin -> Properties by the owner or an
-- Admin like the others. OFF means fully off: the Bar stock screens, the bar
-- bills, the Bar stock report and the FLR registers are refused by the API
-- (and leave the menu), KOTs take nothing off the bar's stock, and the night
-- audit never waits for a bar count. Bar KOTs still print at the bar.
-- ON at every hotel when it goes live, and for a new hotel: an absent row
-- reads ON, as `pos` and New booking's sections do (159).
--
-- Re-runnable.
-- =============================================================================

-- ── The module's name (178's way: added once, never narrowed on a replay) ──
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'hotel_modules'::regclass and conname = 'hotel_modules_known';
  if def not like '%''bar_stock''%' then
    alter table hotel_modules drop constraint hotel_modules_known;
    execute 'alter table hotel_modules add constraint hotel_modules_known '
         || replace(def, 'ARRAY[', 'ARRAY[''bar_stock''::text, ');
  end if;
end $$;

-- ── On unless switched off (159's, with bar_stock in the list) ──────────────
create or replace function app.module_enabled(p_hotel uuid, p_module text)
returns boolean language sql stable as $$
  select coalesce(
    (select is_enabled from hotel_modules
      where hotel_id = p_hotel and module = p_module),
    p_module in ('pos', 'booking_company', 'booking_gst', 'booking_extras',
                 'booking_notes', 'bar_stock')
  );
$$;

comment on function app.module_enabled(uuid, text) is
  'True when the property has this module. Absent rows mean ON for pos, for New booking''s '
  'four sections (159) and for bar_stock (239), OFF for everything else.';

-- ── A KOT takes from the bar only where Bar stock is on (238's trigger, asked first) ──
drop trigger if exists pos_order_lines_take_from_bar on pos_order_lines;
create trigger pos_order_lines_take_from_bar
  after insert or update of kot_status on pos_order_lines
  for each row
  when (app.module_enabled(new.hotel_id, 'bar_stock'))
  execute function app.pos_line_takes_from_bar();
