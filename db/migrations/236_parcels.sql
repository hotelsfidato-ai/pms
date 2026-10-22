-- =============================================================================
-- 236 · Parcels (the owner's D27-359, 22 October)
-- =============================================================================
-- "A parcel option ... a parcel section in the POS where it shows the new
-- parcel." A parcel is the takeaway order type 034 already has, named by the
-- customer (customer_name, 048; table_ref "Parcel · <name>" so every list, the
-- KOT and the bill read it). What is new here:
--
--   * pos_outlets.packing_charge: the GM's packing charge for a parcel, once
--     per parcel, taxed as the food. Null: no charge. No amount is put in.
--   * pos_order_lines.packing: the line that charge makes on a parcel's bill.
--     It goes on with the parcel's first KOT, already 'served', so the bill,
--     its tax and every report add it up as any line; the KOT, the kitchen's
--     screen and the reprints leave it out (it is no dish).
--
-- No new kot_status: 034 rewrites that list on every replay (MEMORY 284).
-- Re-runnable.
-- =============================================================================

alter table pos_outlets add column if not exists packing_charge numeric(12,2)
  check (packing_charge is null or packing_charge > 0);
comment on column pos_outlets.packing_charge is
  'A parcel''s packing charge (D27-359): once per parcel, taxed as the food. Null: none.';

alter table pos_order_lines add column if not exists packing boolean not null default false;
comment on column pos_order_lines.packing is
  'The packing charge on a parcel''s bill (D27-359): a bill line, never a dish - no KOT, '
  'no kitchen screen. One per parcel.';
create unique index if not exists pos_order_lines_one_packing
  on pos_order_lines (order_id) where packing and not voided;
