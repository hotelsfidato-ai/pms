-- =============================================================================
-- 245 · THE PETTY CASH BOOK (the owner's D27-370, 27 October)
-- =============================================================================
-- "A petty cash book - built on the expenses already recorded: each gets a
-- category (Kitchen, Housekeeping, Maintenance, Office, Other) and a photo of
-- the bill, and a Petty cash report shows them by day and category,
-- restaurant and front desk together."
--
-- Built on the two places a paid-out is already recorded, both unchanged,
-- their GM's or owner's yes included (D27-239, D27-242):
--   the restaurant's tin  pos_cash_movements (050), kind 'expense';
--   the front desk drawer cashier_movements (059), kind 'expense'.
--
-- THE CATEGORY. One of five words, the same in both places, and only on an
-- expense. Required of a NEW expense by the two routes that record one; an
-- expense recorded before today has none and shows a dash - so the column
-- stays nullable, and nothing here invents a category for an old one.
--
-- THE PHOTO is an `attachments` row (077), subject_table 'pos_cash_movements'
-- or 'cashier_movements': no new table, nothing to add here.
--
-- Re-runnable: replayed on every deploy.
-- =============================================================================

alter table pos_cash_movements add column if not exists category text;
alter table cashier_movements  add column if not exists category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_cash_movements_category_known') then
    alter table pos_cash_movements add constraint pos_cash_movements_category_known check (
      category is null or (kind = 'expense'
        and category in ('Kitchen', 'Housekeeping', 'Maintenance', 'Office', 'Other')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cashier_movements_category_known') then
    alter table cashier_movements add constraint cashier_movements_category_known check (
      category is null or (kind = 'expense'
        and category in ('Kitchen', 'Housekeeping', 'Maintenance', 'Office', 'Other')));
  end if;
end $$;

comment on column pos_cash_movements.category is
  'A paid-out''s category (D27-370): Kitchen, Housekeeping, Maintenance, Office or Other. '
  'Null on an expense recorded before 27 October 2026, and on money in.';
comment on column cashier_movements.category is
  'A paid-out''s category (D27-370): Kitchen, Housekeeping, Maintenance, Office or Other. '
  'Null on an expense recorded before 27 October 2026, and on money in.';
