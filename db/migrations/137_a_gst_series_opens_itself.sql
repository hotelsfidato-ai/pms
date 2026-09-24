-- =============================================================================
-- 137 · A hotel's GST invoice series for a new year opens itself (D24-22)
-- =============================================================================
-- Written as 137; the master renumbers at merge. Refer to this file by what it
-- does, never by its number.
--
-- FIN-8: app.next_invoice_number (011) raised "No invoice series for hotel X
-- in 2027-28" when the year's invoice_series row was missing, and only a
-- deploy's replay of 025 or provisioning made one. So the first tax invoice of
-- every 1 April failed at every hotel until somebody deployed. The owner's
-- D24-22: the year's series opens itself with its first invoice, as the VAT
-- bill's does ("a separate VAT bill for alcohol"); numbers unchanged.
--
-- The same function, same signature and return type (MEMORY 317), one insert
-- added before the update. The new year keeps the prefix the hotel's latest
-- year used, or its code where it has none - the prefix 025 gives a series.
-- 011's `create or replace` runs first on every replay; this one follows it.
-- =============================================================================

create or replace function app.next_invoice_number(p_hotel_id uuid, p_fin_year text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_prefix text; v_num bigint;
begin
  insert into invoice_series (hotel_id, fin_year, prefix, next_number)
  select h.id, p_fin_year,
         coalesce((select s.prefix from invoice_series s
                    where s.hotel_id = h.id order by s.fin_year desc limit 1), h.code),
         1
    from hotels h where h.id = p_hotel_id
  on conflict (hotel_id, fin_year) do nothing;

  update invoice_series
     set next_number = next_number + 1
   where hotel_id = p_hotel_id and fin_year = p_fin_year
  returning prefix, next_number - 1 into v_prefix, v_num;

  if v_num is null then
    raise exception 'No such hotel %', p_hotel_id;
  end if;

  return v_prefix || '/' || p_fin_year || '/' || lpad(v_num::text, 5, '0');
end
$$;
