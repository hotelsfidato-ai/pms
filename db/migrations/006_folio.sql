-- =============================================================================
-- 006_folio.sql — THE ACCOUNTING SPINE
-- =============================================================================
-- Everything that charges a guest posts here: room rent, restaurant, bar, spa,
-- laundry, minibar, taxes, payments. Front desk, POS and night audit are all
-- just different ways of writing rows into folio_postings.
--
-- Build this before any screen. It is the table every other module depends on,
-- and its shape is the most expensive thing in the system to change later.
--
-- THREE RULES, all enforced by the database rather than by convention:
--
--   1. Money is numeric(12,2). Never float. Ever.
--      Floating point turns Rs 1,847.50 into a day-close that does not balance,
--      and the error compounds silently across seven properties.
--
--   2. Postings are APPEND-ONLY. No UPDATE, no DELETE — enforced by trigger.
--      To correct a charge you post a reversing one. When a guest disputes a
--      bill or an auditor asks why yesterday's total changed, the answer has to
--      still exist.
--
--   3. business_date is a REAL COLUMN, not derived from created_at.
--      A bar bill rung at 01:40 belongs to the PREVIOUS business date. Room
--      charges post during night audit, not at midnight. Derive this later from
--      a timestamp and every daily revenue figure you ever produce is wrong.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- folios — one running account.
-- -----------------------------------------------------------------------------
-- Usually one per reservation, but not always: a company pays the room while
-- the guest pays their own bar tab, which is two folios on one stay. Model that
-- from the start; retrofitting split billing is genuinely painful.
-- -----------------------------------------------------------------------------
create table if not exists folios (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid references reservations(id),

  -- Who settles this folio.
  bill_to        text not null default 'guest',
  company_id     uuid references companies(id),

  status         text not null default 'open',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint folios_bill_to_valid check (bill_to in ('guest', 'company')),
  constraint folios_status_valid  check (status  in ('open', 'closed', 'void')),
  -- A company-billed folio must name the company.
  constraint folios_company_present check (
    bill_to <> 'company' or company_id is not null
  )
);

create index if not exists folios_hotel_status_idx on folios (hotel_id, status);
create index if not exists folios_reservation_idx  on folios (reservation_id);

drop trigger if exists folios_touch on folios;
create trigger folios_touch before update on folios
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- folio_postings — the ledger. Append-only.
-- -----------------------------------------------------------------------------
-- Sign convention:
--   charges  are POSITIVE  (room rent, food, tax)  — guest owes more
--   payments are NEGATIVE  (cash, card, UPI)       — guest owes less
--
-- Folio balance is therefore just  sum(amount).  One column, no special cases,
-- no separate debit/credit columns to keep in step.
--
-- GST is stored PER LINE, not per folio. A single stay legitimately contains
-- both a 12% room band and a 5% restaurant band. Computing tax on the folio
-- total is a tax error, and it is the exact trap already documented in the CRS.
-- -----------------------------------------------------------------------------
create table if not exists folio_postings (
  id             bigserial primary key,
  hotel_id       uuid not null references hotels(id) on delete cascade,
  folio_id       uuid not null references folios(id),

  -- See rule 3 above. Set by whoever posts; night audit owns the roll.
  business_date  date not null,

  category       text not null,
  description    text not null,

  -- Net of tax. Tax is its own columns so an invoice can print the breakup
  -- that GST law requires.
  amount         numeric(12,2) not null,
  tax_rate       numeric(5,2)  not null default 0,
  tax_amount     numeric(12,2) not null default 0,

  -- Where it came from, so POS bills can be traced back and reconciled.
  source_type    text,
  source_id      uuid,

  -- Set on a reversing entry, pointing at the posting it cancels.
  reverses_id    bigint references folio_postings(id),

  posted_by      uuid references staff(id),
  created_at     timestamptz not null default now(),

  constraint folio_postings_category_valid check (category in (
    'room', 'food', 'beverage', 'spa', 'laundry', 'minibar',
    'telephone', 'misc', 'tax', 'discount', 'payment', 'refund'
  )),
  constraint folio_postings_tax_sane check (tax_rate >= 0 and tax_rate <= 100),
  -- A reversal must actually reverse something.
  constraint folio_postings_reversal_signed check (
    reverses_id is null or amount <> 0
  )
);

-- Night audit and every revenue report filter on exactly this pair.
create index if not exists folio_postings_hotel_date_idx
  on folio_postings (hotel_id, business_date);

create index if not exists folio_postings_folio_idx
  on folio_postings (folio_id, id);


-- -----------------------------------------------------------------------------
-- Rule 2, enforced.
-- -----------------------------------------------------------------------------
-- Without this the rule is a comment, and comments do not survive a deadline.
-- With it, an accidental UPDATE raises an exception naming the row.
-- -----------------------------------------------------------------------------
drop trigger if exists folio_postings_append_only on folio_postings;
create trigger folio_postings_append_only
  before update or delete on folio_postings
  for each row execute function app.forbid_mutation();


-- -----------------------------------------------------------------------------
-- folio_balance() — what does this guest owe right now?
-- -----------------------------------------------------------------------------
create or replace function app.folio_balance(p_folio_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(amount + tax_amount), 0)::numeric(12,2)
    from folio_postings
   where folio_id = p_folio_id
$$;


-- -----------------------------------------------------------------------------
-- night_audit_runs — one row per hotel per business date.
-- -----------------------------------------------------------------------------
-- The UNIQUE constraint is the safety net. Someone WILL click the button twice,
-- and two managers at two properties will run it in the same minute. Without
-- this you double-post a night of room revenue and only find out at month end.
--
-- Run the audit itself inside a transaction that takes
--   pg_advisory_xact_lock(hashtext('night_audit:' || hotel_id))
-- so a concurrent second run blocks rather than racing.
-- -----------------------------------------------------------------------------
create table if not exists night_audit_runs (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  business_date  date not null,

  status         text not null default 'running',
  rooms_posted   integer,
  revenue_posted numeric(12,2),
  no_shows       integer,

  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  error_message  text,
  run_by         uuid references staff(id),

  unique (hotel_id, business_date),
  constraint night_audit_status_valid check (status in ('running', 'completed', 'failed'))
);
