-- =============================================================================
-- 197 · A SAC on each invoice line; tax rules by date; meal days on the voucher
--       (P3; the owner's D27-258 Q5, Q6, Q7 and the master's yes, 4 October)
-- =============================================================================
-- After 195 (merged) and 196. Additive and re-runnable: nothing earlier
-- changes its return type (MEMORY 317).
--
--   1  tax rules by the business date: one row per slab per start date (Q7)
--   2  the voucher's meal days, through a definer (Q5)
--   3  a posting keeps the tax kind it was taxed under (Q6): postCharge, the
--      one door, writes it; a room night inserted directly is 'room' by its
--      category. NULL on history.
--   4  an invoice keeps the SAC of each kind as it was when issued (Q6),
--      frozen with the rest by invoices_immutable (025): a later change to
--      tax_sac never alters an issued invoice. NULL on invoices from before.
-- =============================================================================

-- 1 · tax rules by the business date (D27-258 Q7) ---------------------------
-- A slab may now have periods: the same kind and threshold, one rate until a
-- date and another from it (a GST change). One row per slab per start date;
-- the lookup takes the rows valid on the hotel's business date. A rule with no
-- dates is valid always, as every rule before this was. gst_rate_or_null keeps
-- its signature and stays the one place the slab is written (067).
alter table tax_rules drop constraint if exists tax_rules_hotel_id_kind_over_amount_key;
create unique index if not exists tax_rules_one_slab_a_period
  on tax_rules (hotel_id, kind, over_amount, coalesce(valid_from, '-infinity'::date));

create or replace function app.gst_rate_or_null(
  p_hotel uuid,
  p_kind  text,
  p_value numeric
) returns numeric
language sql
stable
as $$
  select rate
    from tax_rules
   where hotel_id = p_hotel
     and kind = p_kind
     and (valid_from is null or valid_from <= app.business_date(p_hotel))
     and (valid_to is null or app.business_date(p_hotel) < valid_to)
     -- The base row (0) always applies; a higher slab applies only when the
     -- value is strictly above it (067).
     and (over_amount = 0 or coalesce(p_value, 0) > over_amount)
   order by over_amount desc, valid_from desc nulls last
   limit 1
$$;

-- 2 · meal days on the voucher (D27-258 Q5) ----------------------------------
-- The voucher is drawn by the sweep with nobody signed in, so its meal days
-- come through a definer, as app.guest_voucher's facts do: the hotel's meal
-- days for the booking's hotel, and nothing else.
create or replace function app.voucher_meal_days(p_reservation uuid)
returns table (meal_plan text, breakfast text[], lunch text[], dinner text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.meal_plan, d.breakfast, d.lunch, d.dinner
    from hotel_meal_days d
    join reservations r on r.hotel_id = d.hotel_id
   where r.id = p_reservation
$$;
revoke all on function app.voucher_meal_days(uuid) from public;
grant execute on function app.voucher_meal_days(uuid) to pms_app;

-- 3 · the kind a posting was taxed under -------------------------------------
alter table folio_postings add column if not exists tax_kind text;
comment on column folio_postings.tax_kind is
  'The tax kind the posting was taxed under (postCharge''s taxKind: room, restaurant, bar, spa ...). '
  'Its invoice line prints that kind''s SAC (D27-258 Q6). NULL: from before 197, or a room '
  'night inserted directly - read as room by its category.';

-- 4 · each kind's SAC, as it was when the invoice was issued ------------------
alter table invoices add column if not exists sac_by_kind jsonb;
comment on column invoices.sac_by_kind is
  'tax_sac as it was at issue: {kind: sac}. A room line with none prints sac_code '
  '(996311); any other kind with none prints a dash. NULL on invoices from before 197.';
