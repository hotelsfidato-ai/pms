-- =============================================================================
-- 232 · A kind's code may be an HSN as well as a SAC (the owner's D27-344,
--       19 October)
-- =============================================================================
-- `tax_sac.sac_code` held a SAC alone: six digits (195). A hotel that sells
-- goods under a kind (bottled water in the minibar, say) types that good's HSN
-- in the same box: 4, 6 or 8 digits, as the CA gives it. A SAC is six digits
-- and still fits. Invoices, the proforma bill and the restaurant bill print it
-- under "HSN/SAC".
--
-- Re-runnable.
-- =============================================================================

alter table tax_sac drop constraint if exists tax_sac_code;
alter table tax_sac add constraint tax_sac_code check (sac_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$');
comment on column tax_sac.sac_code is
  'D27-258 Q6, D27-344: the kind''s HSN or SAC - 4, 6 or 8 digits (a SAC is 6).';
