# Finance — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-22 · alcohol, a switch per property, and the VAT it is taxed under (D21-90, D21-91) — and FIN-4

**Asked for:** the owner's D21-90 ("a switch per hotel - 'serves alcohol'",
off by default) and D21-91 (10% VAT, not GST: one "VAT 10%" line on the
bill, never CGST/SGST, kept out of the GST sales register and the GST part of
the accountant's export, its own VAT ledger; the accountant confirms the
rate). Who sets the rate: D22-32 (owner, admin, GM, accountant) — which is
what PMS-2's `GST` rule in `api/src/roleGate.ts` already says. And the Add
charge dialog's fixed "CGST 2.5% + SGST 2.5%" (FIN-4).

**Shipped:**
- A module switch `alcohol` ("Serves alcohol" on Settings → Modules), owner
  and admin only like the others, off everywhere: no row is written.
- A tax kind `alcohol`, taxed as VAT. Listed on the tax card only where the
  switch is on; one rate, no bands; **never seeded** — "Not set", a dash,
  until somebody types it. While the switch is off the rate cannot be set, a
  section cannot be given the heading, and the till refuses a drink in a
  section still set to it.
- The till rings a dish in an alcohol section that follows its section's
  rate as VAT (`pos_order_lines.tax_scheme`); settling to a room posts it as
  its own VAT posting (`folio_postings.tax_scheme`), split by tax as well as
  rate (`app.pos_order_by_tax`; `pos_order_by_rate` is built from it and
  keeps its shape). A reversal of any posting takes its original's tax, by
  trigger, whoever writes it; a transfer carries it.
- `app.stay_bill` answers `vat` rows; `BillPrint` prints "VAT 10%" as one
  line, and the restaurant's bill does the same. The GST invoice (and so the
  GST sales register) leaves VAT out. The day book has Alcohol and VAT
  columns and its "GST" column (was "Tax") and extra/outlet tax carry none of
  it; the Manager report prints "Tax - VAT 10%" as one line and keeps VAT out
  of its SGST/CGST.
- `GET /:code/tax/:kind/rate?amount=` — the rate one charge would carry. The
  Add charge dialog asks it: GST 18% → CGST 9% + SGST 9% on ₹8,000; a dash
  where nothing is set (FIN-4).
- 067's unguarded rewrite of the menu section's heading list is guarded
  (the first section set to alcohol would have stopped every deploy at 067 —
  seen with the old 067: rerun.sh "067_tax_rules.sql ... violated by some
  row"); rerun.sh now gives its property alcohol, a VAT rate and a section.

**Chosen where the owner's words did not settle it** (questions in the
report): per menu SECTION, not per dish; a dish with its own rate in an
alcohol section stays GST (the soft-drink answer); the VAT is not on the GST
invoice at all and no separate VAT invoice exists; the day book moves VAT out
of Extra tax / Restaurant tax into its own columns, sales unchanged.

**Proved** (each seen failing with its fix taken out): `db/tests/modules/
finance.sql` (25; 4 fail with the trigger, the stay_bill split and the
by-tax grouping broken); `api/test/modules/finance/alcoholVat.test.ts` (13;
10 fail with the switch and till guards out, 6 with the invoice filter, the
day book split, the Manager report's VAT line, the trigger and the rate
route out, 1 with the Manager report's VAT bucket out); web: `addCharge`
(3), `taxCard` (2), `billPrint` (+1), `pos/billVat` (1), accounting (+1),
admin (+2).

**Left open:** the menu import still knows only restaurant, bar, banquet and
other; `migrationNumbers.test.ts` fails on the gap at 125 until the master
renumbers 126.

---

## 2026-09-21 · the bill as it stands — one definition, and the printed bill's made-up GSTIN

**Asked for:** the owner's D21-10 (a guest sees exactly the bill the desk
prints) and, approved the same day, fixing the desk's printed bill.

**Found:** the Bill tab's Invoice print built itself in the browser and
printed "5 Elements By Fidato Hotels · Akkalkot · GSTIN 27AAAAA0000A1Z5" —
the demo's made-up number — at every hotel; "CGST 2.5% / SGST 2.5%" whatever
the lines were taxed at (a room over ₹7,500 is 18%); and counted a reversing
line while leaving out the one it reversed, so a correction came off twice.
Live on 18 September's version too; nobody had been handed one.

**Shipped:** `app.stay_bill(reservation)` (migration 123, invoker rights, so
row security decides who reads it) — the hotel's own name, address and GSTIN,
the ledger's live lines, one CGST/SGST pair per rate, totals, what was paid.
`GET /:code/stays/:id/bill`. `flows/BillPrint.tsx` draws it and computes
nothing; the desk's Invoice dialog uses it, and the guest's page is to.
Exported from the front door.

**Proved:** `api/test/modules/finance/stayBill.test.ts` (2) — with reversing
lines let back in, it fails; `billPrint.test.tsx` (4) — with the demo GSTIN put
back, two fail. On the running laptop: the route answers with the hotel's own
record.

**Still open:** the Add charge window's preview still says "CGST 2.5% +
SGST 2.5%" for every charge; `hotels.cgst_rate`/`sgst_rate` still default to
2.5 (019). The print says "Tax Invoice" with no invoice number — the owner's
to answer.



**Asked for:** 16 September, the brief's first question: which of the two
`/in-house` figures is wrong ("a query, not an opinion"). 17 September, from the
master after the owner's answers: **D17-16** (FIN-2, a stay with no bill shows a
dash and never ₹0, confirmed on screen first) and **FIN-1**.

**Shipped**
- FIN-1: the header of `api/src/modules/finance/billing.ts` now says what the
  file does: two reads, with issuing in `invoices.ts` and the night audit in
  its own service. A comment only; no behaviour changed.
- `DEFECTS.md`: FIN-1 moved to Fixed. FIN-2 records the owner's decision and
  what the trace found. New entry **FIN-3**.

**Found**
- **FIN-3, the critique's `/in-house` P0.** The database says ₹0 for
  `FH-2608-4858`: ₹7,084.69 charged and ₹7,084.69 paid in cash at 11:45 IST on
  16 September. The drawer was right. Both screens call
  `GET /:code/stays/:id/folio`, so this is not two definitions. The list kept a
  copy fetched before the payment, because `src/App.tsx` (core) never lets a
  query go stale and keeps its cache for a week. Not reproduced in a browser.
  The fix is not finance's.
- The same development guest's bill carries 26 test lines. They were written
  by root `MEMORY.md` 277's run of the API suite against the development
  database, and they net to zero.
- **FIN-2 traced:** a stay with no folio gets a folio of **zeros marked
  settled** from the API. The Bill tab prints ₹0 "Settled", the stay panel's
  footer and the In house column print ₹0, and check-out is allowed.
- Tooling, for the master: `db/migrate.sh` hides its own error behind six
  notice lines, and failed twice where the identical `psql` run by hand passed.
  A fresh lane database has no hotel or staff, so `--with-dev-identities`
  fails. `api/scripts/load-demo.ts` failed with "Cannot read properties of
  undefined (reading 'id')" and rolled back. This lane's database is a
  `pg_dump` copy of `fidato` taken on 17 September instead.

**Proved**
- Read-only queries against `fidato`, and the FIN-2 trace in `fidato_finance`,
  whose empty folio on `FH-1409-5032` was removed to make a stay with no bill.
- After FIN-1: `npx tsc --noEmit` in `api/`, exit 0. `npm run lane -- finance`,
  exit 0: three files, all finance's. The web suite was not run, because no web
  file changed.

**Left open**
- **FIN-2 is not built.** It has not been seen on a screen: this chat's
  browser pane serves `D:\fidato pms`, not this copy. Building it changes two
  front-desk files and one core rule, so the split is the master's to make.
- FIN-3's fix is in the core and front desk.

**Commits:** see `git log finance/in-house-balance`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/finance/index.ts`, at first mounting `folios.ts`,
  `billing.ts` and `invoices.ts` whole from `api/src/routes/`.
- Step 4a (`23cd2e4`): the mixed data files cut in place — `postings.ts`
  (folio reads, charges, settle) and `cashier.ts` (the drawer) out of
  `operations.ts`; `billing.ts` kept payments, billable and invoices; `tax.ts`
  out of `roomSetup.ts`; `folios.ts` gained the folio reads from `stays.ts`.
- Step 4 (`db4f061`), moved into this folder:
  - pages — `Billing.tsx`, `Cashiering.tsx`, `Folios.tsx`, `Invoice.tsx`,
    `Invoices.tsx` (from `src/pages/`)
  - flows — `CreditNoteFlow.tsx`, `FolioPanel.tsx`, `TaxRulesCard.tsx`
    (from `src/components/flows/`)
  - data — `billing.ts`, `cashier.ts`, `folios.ts`, `postings.ts`, `tax.ts`
    (from `src/data/repositories/`)
  - the door gained what front desk and inventory use; front desk's move
    (`880a5b6`) repointed this folder's imports to front desk's door.
- Step 5, the server: `folios.ts` moved to `api/src/modules/finance/`
  (`3424882`); `postings.ts` and `cashier.ts` cut out of `operations.ts`
  (`b772047`); `billing.ts` kept receipts and billable folios when the old
  file split four ways (`489271d`); `invoices.ts` moved and gave Form C to
  guests (`1dcf9b7`); `tax.ts` cut out of `inventorySetup.ts` (`3ca215d`).
  `api/test/invoices.test.ts` moved to `api/test/modules/finance/`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- FIN-1 (this folder's `DEFECTS.md`): the header of
  `api/src/modules/finance/billing.ts` still says no invoice number is issued
  and the night audit does not run. A comment, not a screen; not fixed.
- Noticed, not investigated: `getFolioBalance` answers `0` for a stay with
  no folio (`data/postings.ts`).

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's `front-desk.test.tsx`, 2 in
  reports'); with `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of
  204 (the 4 left in `src/App.test.tsx`, not investigated). This change is
  Markdown only.

**Left open**
- FIN-1, and the zero balance above.

**Commits:** `e9dd6b1`, `23cd2e4`, `db4f061`, `3424882`, `b772047`,
`489271d`, `1dcf9b7`, `3ca215d`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
