# Finance — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-27 · Touched by Phase 1, New booking (reservations session)

`getTaxRate` and `listBillingCompanies` on the front door, for New booking's tax beside the rate and its Bill to Company. Nothing else changed.
See `src/modules/reservations/CHANGELOG.md`, 27 September.

---

## 2026-09-27 · Form III at the desk (D27-25) - the guests lane's

The guests lane (`guests/form-iii-27sep`) changed this service's files for
Form III, written in full in the guests changelog of the same day: the bill panel asks a foreign guest's next destination before the check-out button works, and sends it (`flows/FolioPanel.tsx`). Test: `nextDestination.test.tsx`.

---

## 2026-09-27 · Cash and invoice follow-ups: payments take turns (D27-2), the FSSAI number frozen on the invoice (D27-3), a payment over the bill (D27-4)

**Asked for:** the master, branch `compliance/cash-invoice-27sep`, for the
owner's D27-2 to D27-4 - the three items the compliance lane left open (front
desk's CHANGELOG, 26 September) - and, added by the master mid-session, D27-9
(the restaurant's Close day list; POS files, pointer in its CHANGELOG).

**The owner's answers in this chat, 27 September**
- **The outside till's door** (`/api/pos/tickets`): it only puts a restaurant
  bill ON a guest's room bill - no cash changes hands there, and the cash for
  that bill is asked the ₹2 lakh / PAN rule at the desk when it is paid. **Nothing
  added at that door**: a room charge is not cash. (`pos.ts` untouched.)
- **How the desk confirms a payment over the bill:** **a tick in the Settle
  dialog**, "Hold it as the guest's credit", like "Form 97 taken".

**Shipped**
- **A · D27-2.** `POST /:code/stays/:id/payments` takes the guest's turn, then
  the group's (`pg_advisory_xact_lock`, always in that order, held to the end of
  the transaction) before it reads the cash already taken - so two same-second
  cash payments for one guest, or one group, cannot both pass ₹2,00,000. Every
  payment waits its turn, not only cash: the bill read for D27-4 has the same
  race. Refused before any write, as before (MEMORY 243).
- **B · D27-3.** Migration "the FSSAI number on the invoice" (145):
  `invoices.fssai_number`, copied from the hotel at issue and at a credit note,
  as the GSTIN is; `GET /invoices/:number` prints it from the invoice. An
  invoice issued before this, or while the hotel had none, prints a dash.
- **C · D27-4.** The route refuses a payment larger than the bill (the Settle
  dialog's Outstanding, `GET /stays/:id/folio`, via `FOLIO_SELECT`) with "This
  is ₹X more than the bill; it will be held as the guest's credit." and `needs:
  "credit"`, unless `heldAsCredit: true`. The Settle dialog shows the sentence
  and the tick as soon as the amount is over the bill; Take payment stays off
  until ticked; changing the amount takes the tick off; a refusal re-reads the
  bill.
- **D · D27-9.** `GET /:code/till/day-end`: the paid-in/paid-out list left-
  joins `staff`, so cash the group owner recorded is on a GM's list (it was
  dropped - MEMORY 283's fault, as the five bugs lane fixed in `readOrder`);
  `recordedBy` is null where the name is hidden and Close restaurant day prints
  "-" (`pages/DayEnd.tsx`, `data/till.ts`).

**Found**
- Once taken, an overpaid bill's Check out says "This bill is overpaid. Refund
  the difference first." (as before) - "held as the guest's credit" holds while
  the guest stays; at check-out the desk refunds it. Told to the owner.
- Other tests that paid more than a bill: `reports.test.ts`'s advance on a
  future booking and `businessDate.test.ts`'s ₹100 now say `heldAsCredit:
  true`; `cashLimit.test.ts`'s payments on empty bills do too (its own helper).
- A test trap: `pg_stat_activity` read inside an open transaction stays as it
  was first read; the concurrency test polls from another connection.

**Proved** (this copy, database `fidato_s15`, API 8837, web 5237)
- `api/test/modules/front-desk/cashLimit.test.ts`: two concurrent ₹1,00,000
  cash payments on one stay, both held at the stay's folio by another
  transaction until both are in flight - one 200, one 409. With the turn taken
  out: [200, 200]. Over the bill: refused with the sentence and nothing
  written, taken with `heldAsCredit`, asked again once the bill is paid - two
  tests fail with the check taken out.
- `api/test/modules/admin/fssai.test.ts`: an invoice issued with
  12345678901234 still prints it after the setting is cleared - fails reading
  the hotel's live number (null).
- `src/modules/finance/overpayment.test.tsx`: no warning at the bill; ₹500.00
  more names it and holds the button until ticked, then sends `heldAsCredit`;
  a new amount asks again - two fail with the dialog's check taken out.
- Screens, the app's own browser: Settle on a ₹1,890 bill, ₹2,500 typed - the
  sentence (₹610.00), the tick, the button off, then taken (Overpaid ₹610); the
  same at 375 wide. An invoice issued with FSSAI 11111111111111, the setting
  then changed to 22222222222222: the invoice page still prints 11111111111111.
- D: `api/test/modules/pos/till.test.ts` "shows a GM the cash the owner paid
  in, with no name" - with the inner join back, the movement is missing;
  `src/modules/pos/functionOrders.test.tsx` "Cash in · - · 20:15" - fails
  printing the null.
- The six checks on `de80810` (cp6 `7a65cb1` merged in), 27 September, each
  exit 0: `tsc -p tsconfig.app.json` clean; `api` tsc clean; web 82 files, 710
  tests; API 99 files, 1572 tests; database 1180 assertions; the
  replay "all 145 migrations are re-runnable".

**Left open**
- Whether a guest's credit should ever carry past check-out (it is refunded
  today) - the owner's.

**Commits:** `4beff57`, `ccb19c6` (with merges of cp6 `c70a40a`, `de80810`), and this note.

---

## 2026-09-25 · The Bill tab offers only what the server will do (D24-18, D25-29) — FIN-9

**Asked for:** the master, branch `fixes/billtab-date-25sep` (the Bill tab
and date session): A - hide the Bill tab's Add charge, Settle, Interim bill,
Split the bill and Check out from anyone the server refuses, each reading
the question the server asks; B and C are the channel manager's and
housekeeping's (their CHANGELOGs).

**The owner's answers in this chat, 25 September** (now D25-29)
- The Interim bill, a print the server does not gate: **for whoever may see
  bills** (`invoice: view`).
- A line's Reverse and Move, which the server also refuses housekeeping:
  **hidden too** from anyone the server refuses.

**Shipped** - `flows/FolioPanel.tsx`: each control asks roleGate's question
of its write from the one matrix (`can(role, ...)`, as the front desk's
`StayView.tsx` and `StayActions.tsx` do): Add charge and Split the bill
`invoice: create`, Settle `payment: create`, Reverse and Move `invoice:
edit`, Check out `reservation: edit` (its allowed-check no longer asked for
anyone else), the Interim bill `invoice: view`. Housekeeping sees the
balance and the lines; the accountant everything but Check out; a viewer
only the print. Who may do what is unchanged.

**Proved** (this copy, database `fidato_s7`, API 8821, web 5221)
- `billTabControls.test.tsx`: reception all seven controls, housekeeping
  none, the accountant all but Check out, a viewer only the Interim bill.
  On the old panel both tests fail (housekeeping and the accountant offered
  everything).
- The checks on `bd1bca9` (cp6 `3399768` merged in; no migrations from
  here): see the channel manager's entry of today for the six, run once for
  the whole branch.
- Screens, `.local/screenshots/2026-09-25-billtab/` in the main folder,
  desktop 1280x800 and phone 390x844, headless Edge (InPrivate, its own
  port) signed in with the development sign-ins: Ganesh Patil's stay (204),
  Bill tab - `housekeeping-*` no buttons, `reception-*` a Reverse on each
  line, Add charge, Settle, Interim bill, Split the bill and Check out;
  `what-each-panel-offered.json` lists the buttons each page reported.

**Left open** - housekeeping still reads the bill's balance and lines (the
server lets them; not asked). FIN-10, an invoice test that passes or fails by
the order the files run in (found in the full API run, not caused here).

**Commits:** `4e8722d` (A-C and tests), `696b563` (DEFECTS, D25-29 cited),
merges `3d5fa8e`, `bd1bca9`, and these notes.

---

## 2026-09-24 · a VAT bill for alcohol (D22-44), "Interim bill" (D22-7), the tax card on Invoices (D23-1), the three rule-breakers (D22-9)

Two helpers started this on 23 September and were stopped mid-task
(`finance/vat-bill-interim`, `finance/rule-breakers-xlsx`, both "WIP, NOT
FINISHED"). This session merged both, read every change, finished them and
proved them. Three things the first helper had switched off while testing
were still off (a `check (true)`, an `if false and exists`, a `void 0` where
the cancellation's reason is refused) and two were real bugs: the VAT number
used `lpad(…, 4)`, which cuts 10000 back to "1000" (root MEMORY 280), and a
restaurant VAT bill summed the drinks before their share of the discount.

**Asked for:** D22-44 (a VAT bill for alcohol, beside the GST document of
the same sale, its own series per hotel restarting each 1 April, each naming
the other, cancelled like a credit note by owner, admin, GM and accountant);
D22-7 (the desk's print says "Interim bill"); D23-1 (the tax card on a
finance screen the accountant opens); D22-9's three finance rule-breakers.

**The owner's answers, 24 September** (asked in the finance chat):
- the stay's VAT bill is made **with the tax invoice** on Invoices, not at
  check-out (so each can name the other);
- the desk's print says **"Interim bill" before and after check-out** (the
  numbered tax invoice is issued on Invoices);
- the tax card on Invoices is shown **only to owner, admin, GM and
  accountant**;
- Excel is **its own choice in the Format list** (accounting's CHANGELOG);
- an invoice issued again after a credit note **names the VAT bill still
  standing**;
- Payments' "Taken by" **names the person** (it printed "admin");
- the night audit's room lines say **"Night audit"**, not who pressed Run
  (asked after the night-audit session saw a staff uuid there).

**Shipped:**
- Migration "a separate VAT bill for alcohol" (135 in this branch):
  `vat_bill_series`, `app.next_vat_bill_number` (the year's row opened by its
  first bill, so 0001 again each 1 April with no deploy; four digits, more
  after 9999), `vat_bills` (never changed or deleted, 025's trigger; a
  cancellation is its own numbered row, figures negated, with a reason - a
  check - once per bill), `app.issue_vat_bill` (the folio's live VAT postings,
  or the order's VAT group after its share of the discount; none twice for
  one folio).
- The tax invoice issues the VAT bill in the same transaction; the invoice
  names it (or the one still standing, after a credit note) and it names the
  invoice. The till issues one when a bill is paid by cash, card, UPI or
  split, and the restaurant bill prints its number. `GET /vat-bills`,
  `GET /vat-bills/:number`, `POST /vat-bills/:number/cancel` (roleGate:
  `approve` on invoice). `pages/VatBill.tsx`, a VAT bills table on Invoices.
- "Interim bill" on the Bill tab's print, always.
- The tax card on Invoices for the four who may set a rate.
- D22-9 (a): migration "a new hotel has no GST rate until somebody sets one"
  (136 in this branch) - no default, no NOT NULL on `hotels.cgst_rate` /
  `sgst_rate`; stored rates untouched. The property record answers null; a
  charge refused for a missing rule says where to set it: "under Rooms and
  rates → Room types or Finance → Invoices".
- D22-9 (b): `const USER = "front desk"` and the three dead `user` fields
  gone (FD-2's way); a bill line names who posted it (`app.posted_by_name`),
  "Night audit" for the audit's room charge, a dash for nobody. So does
  Payments' "Taken by".
- D22-9 (c): every finance write route read for a refusal after a write;
  one found (`postCharge` opened the folio before asking for the rate) and
  moved (FIN-7).

**Proved** (each guard seen failing with its change taken out, then put
back byte for byte):
- database `finance gst` (1), `finance vat bill` (16) - with the reason
  check, the no-second-bill guard and the no-default migration broken, all
  three failed; the lpad and discount bugs failed before they were fixed;
- API `alcoholVat` (+5), `signedLines` (3, new), `roleGate` (+2): the
  cancellation's reason refusal, `postCharge`'s order, `posted_by_name`,
  Payments' name, VAT issuing with the invoice and at the till, and the
  re-issued invoice's naming each failed their own test when removed;
- web `billPrint` (+2), `taxCard` (+7), `vatBill` (9);
- on screen, `fidato_s1`, desktop and phone
  (`.local/screenshots/2026-09-24-finance/`): a cash bill got
  VAT/5EL/2026-27/0001; room 202's whisky went on its bill, and its tax
  invoice 5EL/2026-27/00001 (issued by the Test Accountant) came with
  VAT/5EL/2026-27/0002 (₹550), each naming the other; the till's line reads
  "Group Owner" and the demo's own room line "-" (a desk charge read "Test
  Reception" in the first pass). Retaken on the tree merged with cp6 ea01aef,
  on a debugging port of its own: the night audit session's Edge had used
  9333 at the same time as the first pass.
- 5EL's stored 2.50/2.50 survived a full replay of 136 migrations
  (`db/migrate.sh` on `fidato_s1`, on the tree merged with cp6 ea01aef);
  `rerun.sh`: all 136 re-runnable.

**Then, the owner's D24-22 and D24-25** (decided on the master's list the
same afternoon): FIN-8 fixed - the year's GST series opens itself with its
first invoice (migration 138 in this branch, same function signature; db
"finance gst" 4, the new-year check stops the suite with the insert switched
off); the Bill tab's button says "Interim bill" (billPrint clicks it by that
name, and fails with "Invoice" back). D24-23 and D24-24 are in reports' and
accounting's notes.

The till's two "no rate" sentences and the night audit's now name both
places the rate is set, as `postCharge`'s does (the master's request, once
those lanes were merged).

**Left open:** a function's bill issues no VAT bill (it has no GST
document). `housekeeping/roomStatus.ts` still selects `cgst_rate` /
`sgst_rate` typed as strings, now nullable, and uses neither (housekeeping's
file).

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
