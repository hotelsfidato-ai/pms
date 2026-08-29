-- =============================================================================
-- 025_invoices_form_c.sql — a GST invoice you could hand to an auditor,
--                           and the Form C obligation tracked
-- =============================================================================
-- Stage 8. `invoices`, `invoice_series` and app.next_invoice_number() have
-- existed since 011 and NOTHING HAS EVER CALLED THEM. The schema was right and
-- unused, which is a particular kind of debt: it looks finished.
--
-- WHAT A GST TAX INVOICE MUST CARRY (Rule 46, CGST Rules 2017)
--
--   supplier name, address, GSTIN            hotels
--   a consecutive number, unique per         invoice_series (011, correct)
--     financial year
--   date of issue                            invoices.issued_at
--   recipient name and address               NEW — a folio has no name of
--     and GSTIN if registered                  its own; the guest or the
--                                              company is the recipient
--   HSN/SAC of the supply                    NEW — 996311 for accommodation
--   taxable value                            derivable, stored for immutability
--   RATE AND AMOUNT of CGST and SGST         NEW — 011 stored one tax_total,
--     SEPARATELY                               and a combined figure is not a
--                                              compliant invoice
--   place of supply                          NEW — see below, it is the one
--                                              people get wrong
--
-- PLACE OF SUPPLY, AND WHY IT IS ALWAYS THE HOTEL
--
--   For accommodation, the place of supply is where the property IS —
--   IGST Act s.12(3)(b) — not where the guest comes from. So a hotel supply
--   is ALWAYS intra-state: CGST + SGST, never IGST, even for a guest flying in
--   from Delhi to Maharashtra. Getting this wrong means charging IGST on every
--   out-of-state guest, which is the single most common GST error in Indian
--   hospitality, and it is wrong in a direction that takes years to unwind.
--
--   Stored per invoice rather than derived at print time, because a property's
--   state could be corrected in `hotels` later and every invoice already issued
--   must keep saying what it said.
--
-- AN ISSUED INVOICE CANNOT BE CHANGED
--
--   Not by anyone, at any privilege level. A wrong invoice is corrected with a
--   CREDIT NOTE, which is its own document with its own number — the same
--   shape as the append-only ledger, for the same reason. The trigger below
--   enforces it; a grant would not, because a superuser ignores grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What 011 could not know it would need
-- -----------------------------------------------------------------------------
alter table invoices
  add column if not exists recipient_name   text,
  add column if not exists recipient_gstin  text,
  add column if not exists recipient_address text,
  add column if not exists place_of_supply  text,
  add column if not exists sac_code         text not null default '996311',
  add column if not exists taxable_value    numeric(12,2),
  add column if not exists cgst_total       numeric(12,2),
  add column if not exists sgst_total       numeric(12,2),
  -- The business date the invoice belongs to, which is not necessarily the
  -- calendar date it was printed on. Same reason every posting carries one.
  add column if not exists business_date    date,
  -- Set on a credit note, pointing at the invoice it corrects.
  add column if not exists credits_id       uuid references invoices(id),
  add column if not exists reason           text;

comment on column invoices.place_of_supply is
  'The state of the PROPERTY, always — IGST Act s.12(3)(b). Accommodation is '
  'supplied where the hotel is, so it is intra-state (CGST+SGST) regardless of '
  'where the guest came from. Stored, not derived, so a later correction to '
  'hotels.state cannot rewrite invoices already issued.';

comment on column invoices.sac_code is
  '996311 — accommodation in hotels and similar. Stored per invoice because a '
  'property may one day invoice something else.';

comment on column invoices.credits_id is
  'Set on a CREDIT NOTE. An issued invoice is never edited; it is corrected by '
  'a second document carrying its own number, exactly as a folio posting is '
  'corrected by a reversal.';

-- A credit note says why. "Corrected" with no reason is not a record.
alter table invoices drop constraint if exists invoices_credit_has_reason;
alter table invoices add constraint invoices_credit_has_reason
  check (credits_id is null or reason is not null);

-- One credit note per invoice. Two clerks pressing the button together must
-- not issue two, for the same reason a posting may be reversed once (021).
create unique index if not exists invoices_one_credit_note
  on invoices (credits_id) where credits_id is not null;

-- NO unique index on folio_id, deliberately.
--
-- The obvious guard is `unique (folio_id) where credits_id is null`, and it
-- was here. It is too strict: once an invoice is credited, GST requires a
-- CORRECTED invoice to be issued, and a partial index cannot express "one
-- invoice that has not been credited" because a predicate cannot see other
-- rows.
--
-- The harm being prevented is a double-click producing two numbers for the
-- same money. That is a race, not a rule, so it is held with an advisory lock
-- on the folio for the duration of the issuing transaction — see
-- api/src/routes/invoices.ts. A second click waits, then finds the first
-- invoice and is answered with it.
--
-- What IS a rule, and is enforced here: one credit note per invoice.


-- -----------------------------------------------------------------------------
-- Issued means issued
-- -----------------------------------------------------------------------------
create or replace function app.reject_invoice_change()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Invoice % cannot be % - an issued tax invoice is immutable.',
    coalesce(old.number, '?'),
    -- The whole word. `lower(tg_op)` gave "cannot be update", and a
    -- clever '%d' that appended the letter was worse: correct by
    -- accident and unreadable to whoever edits it next.
    case tg_op when 'UPDATE' then 'changed' else 'deleted' end
    using hint = 'Issue a credit note instead. It carries its own number.';
  return null;
end
$$;

drop trigger if exists invoices_immutable on invoices;
create trigger invoices_immutable
  before update or delete on invoices
  for each row execute function app.reject_invoice_change();

-- Belt as well as braces: pms_app has no business holding the privilege even
-- with the trigger in place. `alter default privileges` in 010_roles.sql grants
-- update and delete on every new table, so this must REVOKE — naming a shorter
-- grant list would change nothing (MEMORY.md defect 21).
revoke update, delete on invoices from pms_app;


-- -----------------------------------------------------------------------------
-- Form C — foreign nationals, to the FRRO within 24 hours
-- -----------------------------------------------------------------------------
-- Every foreign national staying at an Indian hotel must be reported to the
-- Foreigners Regional Registration Office within 24 hours of arrival. It is a
-- legal obligation on the property, not on the guest, and the penalty falls on
-- the hotel.
--
-- THIS SYSTEM CANNOT FILE IT. Filing happens on the government's own portal,
-- and pretending otherwise would be worse than not helping at all — a hotel
-- that believed the PMS had filed would stop filing.
--
-- What it can do is name every stay that owes a filing, show the deadline, and
-- record that somebody did it. That is a register, and a register is what an
-- inspection asks for.
-- -----------------------------------------------------------------------------
create table if not exists form_c_filings (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id),
  guest_id       uuid not null references guests(id),

  -- What the FRRO portal gave back. Without it there is no evidence a filing
  -- happened, and evidence is the entire point of a register.
  reference      text not null,
  filed_at       timestamptz not null default now(),
  filed_by       uuid references staff(id),
  notes          text,

  -- One filing per stay. A guest reported twice is a data-entry error, not a
  -- second obligation.
  unique (reservation_id)
);

comment on table form_c_filings is
  'Evidence that a foreign national was reported to the FRRO. This system does '
  'NOT file — that happens on the government portal. It names who owes a '
  'filing and records that somebody did it.';

do $rls$
declare t text;
begin
  foreach t in array array['form_c_filings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;
end
$rls$;

-- A filing that happened, happened. Removing the evidence is the one thing
-- nobody should be able to do to a compliance register.
revoke update, delete on form_c_filings from pms_app;


-- -----------------------------------------------------------------------------
-- Who owes a filing, and by when
-- -----------------------------------------------------------------------------
create or replace function app.form_c_due(p_hotel_id uuid)
returns table (
  reservation_id uuid,
  guest_name     text,
  nationality    text,
  passport       text,
  room_number    text,
  arrived        date,
  due_by         timestamptz,
  overdue        boolean,
  filed          boolean,
  reference      text
)
language sql
stable
as $fn$
  select r.id,
         g.full_name,
         g.nationality,
         -- Passport lives in guest_documents, not guests: 013_policies.sql
         -- split it out because a group-level read let a clerk at any property
         -- see the passport of a guest who had only stayed somewhere else.
         -- The LEFT JOIN matters — a foreign national with no document row
         -- still owes a filing, and must appear here with a blank passport
         -- rather than vanish from the register.
         gd.id_number,
         coalesce(rm.number, '—'),
         r.check_in,
         -- 24 hours from arrival. Measured from the CHECK-IN DATE at the
         -- property's own midnight rather than from a timestamp, because the
         -- reservation records a date and inventing an hour would put a
         -- deadline in front of somebody that the data cannot support.
         (r.check_in + 1)::timestamptz,
         (r.check_in + 1)::timestamptz < now() and f.id is null,
         f.id is not null,
         f.reference
    from reservations r
    join guests g on g.id = r.guest_id
    left join guest_documents gd on gd.guest_id = g.id
    left join room_assignments ra on ra.reservation_id = r.id
                                 and ra.released_at is null
    left join rooms rm on rm.id = ra.room_id
    left join form_c_filings f on f.reservation_id = r.id
   where r.hotel_id = p_hotel_id
     -- A foreign national is anybody not Indian. Stored as a country code, so
     -- this is the whole test.
     and g.nationality <> 'IN'
     and r.status in ('checked_in', 'checked_out')
   order by r.check_in desc
$fn$;

comment on function app.form_c_due(uuid) is
  'Foreign nationals who have stayed, whether their Form C has been filed, and '
  'whether the 24-hour deadline has passed. The obligation is the hotel''s; '
  'this only makes it visible.';


-- -----------------------------------------------------------------------------
-- Every property needs a series before it can invoice anything
-- -----------------------------------------------------------------------------
-- app.next_invoice_number() raises 'No invoice series for hotel X' without
-- one, which is correct and unhelpful at 8am on the first of April. Seed the
-- current financial year for every active property.
-- -----------------------------------------------------------------------------
insert into invoice_series (hotel_id, fin_year, prefix, next_number)
select h.id, app.current_fin_year(h.id), h.code, 1
  from hotels h
 where h.is_active
on conflict (hotel_id, fin_year) do nothing;


-- -----------------------------------------------------------------------------
-- And for every property created from here on
-- -----------------------------------------------------------------------------
-- Backfilling the properties that exist today is not enough. The demo loader
-- deletes and recreates 5EL AFTER the migrations run, so the freshly created
-- property had no series and the first invoice failed with 'No invoice series
-- for hotel ... in 2026-27' — which is the function being right about a gap
-- somewhere else.
--
-- app.provision_property() is one path to a new property. A direct INSERT is
-- another, and the loader takes it. Rather than teach both to remember, the
-- database does it: a property cannot exist without a way to number its
-- invoices, and that is a fact about properties, not about whoever made one.
--
-- Same principle as the /api/* auth gate: a new route is authenticated by
-- existing rather than by remembering.
-- -----------------------------------------------------------------------------
create or replace function app.open_invoice_series()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into invoice_series (hotel_id, fin_year, prefix, next_number)
  values (new.id, app.current_fin_year(new.id), new.code, 1)
  on conflict (hotel_id, fin_year) do nothing;
  return new;
end
$fn$;

drop trigger if exists hotels_open_invoice_series on hotels;
create trigger hotels_open_invoice_series
  after insert on hotels
  for each row execute function app.open_invoice_series();

comment on function app.open_invoice_series() is
  'Every property gets an invoice series the moment it exists. A hotel that '
  'cannot number an invoice is not a hotel that can take a booking.';


-- -----------------------------------------------------------------------------
-- Proof, where the fixtures are: a brand new property can invoice immediately.
-- -----------------------------------------------------------------------------
do $selftest$
declare v_hotel uuid; v_num text;
begin
  -- Codes are [A-Z0-9]{2,10} — hotels_code_format, 002_tenancy.sql.
  insert into hotels (code, name, city, state, timezone)
  values ('ZZSELFTEST', 'series self-test', 'x', 'MH', 'Asia/Kolkata')
  returning id into v_hotel;

  select app.next_invoice_number(v_hotel, app.current_fin_year(v_hotel))
    into v_num;

  if v_num is null or v_num not like 'ZZSELFTEST/%' then
    raise exception
      '025: a new property could not issue an invoice number (got %). '
      'The trigger did not fire, and the first bill of the first stay '
      'would fail.', coalesce(v_num, 'null');
  end if;

  /* `hotels_no_delete` refuses this — "A property is deactivated, never
     deleted" — and it is right about every property that was ever real.
     This one was never real: it existed for three statements to prove a
     trigger fires. Lifted for exactly that, and restored immediately, the
     same way 017 does for the placeholder seed and the demo loader does
     for a reload. Deactivating instead would leave a fictional property
     in `hotels` forever, which is a worse answer. */
  alter table hotels disable trigger hotels_no_delete;
  delete from invoice_series where hotel_id = v_hotel;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;
end $selftest$;
