-- =============================================================================
-- 145 · The FSSAI number frozen on the invoice when it is issued (D27-3)
-- =============================================================================
-- The owner, 27 September: an issued invoice keeps the FSSAI licence number
-- it was issued with, as it keeps the GSTIN, and prints it from there - a
-- hotel changing its number later does not rewrite a document already given
-- to a guest. Copied from hotels.fssai_number by the issue and the credit note
-- (api/src/modules/finance/invoices.ts). An invoice issued before this, or
-- while the hotel had none, holds null and prints a dash.
-- =============================================================================

alter table invoices add column if not exists fssai_number text;

comment on column invoices.fssai_number is
  'The hotel''s FSSAI licence number as it stood when this invoice was issued '
  '(D27-3). Null when it had none: printed as a dash.';
