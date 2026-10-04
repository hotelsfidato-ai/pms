-- =============================================================================
-- 199 · A company over its credit limit, allowed with a reason (the owner's
--       D27-275 part 5, 4 October)
-- =============================================================================
-- A booking or a charge billed to a company whose City ledger balance plus
-- this amount is over companies.credit_limit is refused (finance's
-- creditLimit.ts). The owner, an Administrator or the GM may allow it with a
-- reason, and each allowance is a row here: audited, so it is in the
-- activity log under the name of whoever allowed it.
--
-- Append-only: nothing edits or removes an allowance. Re-runnable.
-- =============================================================================

create table if not exists credit_limit_allowances (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  company_id  uuid not null references companies(id),
  -- What was allowed, in words: the company, and the booking or the charge.
  title       text not null,
  -- This booking's or charge's amount, with its GST, and how far over it went.
  amount      numeric(12,2) not null check (amount > 0),
  over_by     numeric(12,2) not null check (over_by > 0),
  reason      text not null check (length(trim(reason)) > 0),
  allowed_at  timestamptz not null default now()
);

comment on table credit_limit_allowances is
  'A booking or charge allowed over its company''s credit limit, with the '
  'reason (D27-275). Append-only; the audit log names who allowed it.';

alter table credit_limit_allowances enable row level security;
alter table credit_limit_allowances force  row level security;
drop policy if exists credit_limit_allowances_read on credit_limit_allowances;
create policy credit_limit_allowances_read on credit_limit_allowances
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
-- The three who may allow it, at this hotel (or a group administrator).
drop policy if exists credit_limit_allowances_write on credit_limit_allowances;
create policy credit_limit_allowances_write on credit_limit_allowances
  for insert with check ( app.manages_hotel(hotel_id) );
revoke all on credit_limit_allowances from pms_app;
grant select, insert on credit_limit_allowances to pms_app;

drop trigger if exists credit_limit_allowances_audit on credit_limit_allowances;
create trigger credit_limit_allowances_audit
  after insert on credit_limit_allowances
  for each row execute function app.write_audit();
