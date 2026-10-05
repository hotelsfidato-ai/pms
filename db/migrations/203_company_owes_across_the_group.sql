-- =============================================================================
-- 203 · What a company owes across the whole group (the owner's D27-279 (6),
--       4 October)
-- =============================================================================
-- A company's credit limit is the group's (C-9), so the check that refuses a
-- booking or charge over it (finance's creditLimit.ts, D27-275) counts what
-- the company owes at EVERY hotel. A person sees only their own hotels' rows,
-- so this is a definer: one number, never the rows behind it.
--
-- THE CITY LEDGER'S MEANING, its closing balance for the company summed over
-- the hotels (reports' cityLedgerMoves): bills settled "Bill to company"
-- (payments 'city_ledger' on a posting still standing, not a reversal and not
-- reversed), the bill's own company else its booking's, less what the
-- company paid (company_payments, its reversals included), each up to its
-- hotel's business date. ⚠ The two are one definition written twice; a
-- change to either is a change to both (api/test/modules/finance/creditLimit).
--
-- Re-runnable.
-- =============================================================================

create or replace function app.company_owes(p_company uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(-fp.amount)
      from folio_postings fp
      join payments p on p.posting_id = fp.id and p.method = 'city_ledger'
      join folios f on f.id = fp.folio_id
      left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
     where coalesce(f.company_id, r.company_id) = p_company
       and fp.category = 'payment'
       and fp.reverses_id is null
       and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
       and fp.business_date <= app.business_date(fp.hotel_id)), 0)
  - coalesce((
    select sum(cp.amount)
      from company_payments cp
     where cp.company_id = p_company
       and cp.received_on <= app.business_date(cp.hotel_id)), 0)
$$;

comment on function app.company_owes(uuid) is
  'What a company owes at every hotel of the group now: the City ledger''s '
  'closing balance for it, summed (D27-279). For its credit limit.';

revoke all on function app.company_owes(uuid) from public;
grant execute on function app.company_owes(uuid) to pms_app;
