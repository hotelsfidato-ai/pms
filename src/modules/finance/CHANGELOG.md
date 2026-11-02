# Finance — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-11-02 · The Folios page reads the stays with a balance (D27-387, the load test)

**Shipped.** `data/folios.ts`: `listOpenFolios` reads `/stays?owing=1`, not every booking. By balance, not date, as a guest who has left can still owe. The Calendar still passes its own window.

**Proved.** `api/test/modules/front-desk/staysAskedBy.test.ts`: the same stays as GET /folios lists.

---

## 2026-10-30 · Next destination for a foreign companion (D27-382)

**Shipped.** `flows/FolioPanel.tsx`: the server's `needs: "next-destination"` opens the box on an Indian guest's bill, for a foreign adult recorded on the stay. Only the server knows, so the refusal is the way through. The whole entry is the guests changelog's. **Proved:** `nextDestination.test.tsx`, "opens the box when the server says a foreigner is in the room".

---

## 2026-10-28 · The tax invoice in the guest's company's name (the owner's D27-371)

**Shipped.** `invoices.ts`: the stay's invoice route makes a guest's bill out
to the guest's own company when the booking carries its GSTIN (name - the
guest's own with only a GSTIN typed -, GSTIN, address), and only where
`RECIPIENT_COMPANY` names no company, so Bill to company still wins.
`recipientName` holds the name rule once; `billing.ts`'s Invoices list
("Billed to") reads it too. `RECIPIENT_COMPANY` is unchanged (it is a
`companies` row: credit limits and 216's automatic send), so 216 is unchanged
and the guest's-company invoice is sent to the guest by itself.
Who pays, folios, the city ledger: untouched. The GST sales register needed
no change: it reads the invoice's recipient and GSTIN.

**Proved.** `api/test/modules/reservations/guestCompany.test.ts`: the invoice
to the company while every bill stays the guest's; the register's row with
the GSTIN and name; a proprietor's GSTIN alone; Bill to company wins. Finance's
API tests with the rest: 66 files, 607 tests.

---
## 2026-10-27 · The petty cash book (the owner's D27-370), a helper's lane

**Asked for:** each paid-out, at the desk and in a restaurant, gets a category (Kitchen, Housekeeping, Maintenance, Office, Other) and a photo of its bill; a Petty cash report shows them by day and category, both places together. No float, top-ups or balance.

**Shipped** Migration 245: `category` on `cashier_movements` and `pos_cash_movements`, held to the five words and to expenses by `*_category_known` checks (nullable: an expense from before shows a dash). `api/src/modules/finance/expenses.ts`: `EXPENSE_CATEGORIES`, `categoryProblem` (a new expense needs one, money in takes none; refused before the first write), `putExpensePhoto`/`serveExpensePhoto` (the photo in `attachments` against the movement, behind the paid-out's own door, as a bar bill's). Through finance's front door for the till. `cashier.ts`: the category taken and stored, the movement's id returned, each movement's `category` and `photo`, and `POST/GET /:code/cashier-shift/movements/:id/photo` (roleGate: DRAWER to add; `payment` or `invoice` view to read). Web: `data/expenses.ts` (the list, the photo calls), `flows/ExpenseFields.tsx` (`ExpenseFields`: Category and Photo of the bill; `ExpensePhoto`: open it or Add photo), both on the front door for the restaurant's Cash step; Cashiering's Record dialog and list use them. Manual A4.10 and A12.7.

**Proved** `api/test/modules/finance/pettyCash.test.ts` (both places, the photo, the report), `src/modules/finance/pettyCash.test.tsx`, `db/tests/modules/finance.sql` (petty cash). The numbers are in the helper's report to the master.

**Left open** Whether the photo is required; whether waiting and refused expenses belong in the report's totals; who reads the report - the owner's (questions with the helper's report).

## 2026-10-19 · Guest documents like the old system's (the owner's D27-344 to D27-348)

**Shipped** The interim bill is the **proforma bill**, drawn by the tax invoice's own sheet (`flows/BillPrint.tsx` `proformaOf`, `InvoiceSheet`'s `proforma` in `pages/Invoice.tsx`; the Bill tab's button and `pages/InterimBill.tsx`), with the hotel's contacts, each line's HSN/SAC, the stay and the payments (`folios.ts` GET bill, `stayFacts`/`paymentsOn` in `invoices.ts`). **The tax invoice at check-out** follows the hotel's setting (229): issued and printed by itself in two copies, ORIGINAL FOR RECIPIENT and DUPLICATE FOR SUPPLIER (`useInvoicePrinter`, `useInvoiceCopies`, `flows/TaxInvoiceStep.tsx`), or offered, or left to Invoices. The invoice prints the **G.R. card no** (230). A kind's code is **HSN/SAC**, 4, 6 or 8 digits (232; `tax.ts`, `TaxRulesCard`). Front door: `proformaOf`, `InvoiceSheet`, `useInvoiceCopies`; the server's `stayFacts`. **Proved** `billPrint`, `printedBills`, `billTabControls`, `invoiceLayout`, `taxInvoiceAtCheckOut`, `taxSacP3`, `testHotel` (snapshots updated on purpose). The root `CHANGELOG.md` has the whole entry and the gate numbers.

## 2026-10-17 · The invoice in Fidato's design, both logos, one A4 PDF (the owner's D27-343)

**Shipped** `pages/Invoice.tsx` in Fidato's document style (`DocMasthead` with both logos, `DocParties`, `DOC_TH`/`DOC_TD`, `DocTotals`, `DocFacts`, `DocFooter` with the group's office), one A4 page for an ordinary stay. The e-mailed PDF is guest messaging's (`invoiceDocument.ts`), drawn the same. **Proved** `invoiceLayout.test.tsx`; the root `CHANGELOG.md` has the whole entry.

## 2026-10-17 · The printed invoice like the hotel's old one (the owner's D27-342)

**Shipped** `pages/Invoice.tsx` laid out as the owner's old folio invoice (stay facts, a 12-column line table, payments, tax by rate, totals, Reception/Cashier, two signatures; `splitByLine`); `invoiceFacts` adds `stay`, `payments` and the hotel's phone, e-mail, website and PAN. **Found** MEMORY 419 (a test's empty-bill search). **Proved** `invoiceLayout.test.tsx`, `api/test/modules/finance/perBill.test.ts`, `invoices.test.ts`. The root `CHANGELOG.md` has the whole entry.

## 2026-10-17 · The tax invoice on the Bill tab after check-out (the owner's D27-341)

**Shipped** `flows/TaxInvoiceStep.tsx` (Issue tax invoice, then Print or send, where Check out was; per bill; invoice create issues), `FolioPanel.tsx` (`checkedOut`: the panel stays open after a check-out, the lists asked again when it closes), `listBillable(hotelId, stayId?)` and `GET /:code/billable?stay=`. **Proved** `taxInvoiceAtCheckOut.test.tsx`, `api/test/modules/finance/perBill.test.ts`; each fails with its fix taken out. The root `CHANGELOG.md` has the whole entry.

## 2026-10-16 · Refunds and cash after the owner's D27-337: the refund limit, a cash refund to the rupee, the master bill's cash

**Asked for:** the owner, "all as recommended" on lane B's questions: (a) a refund offers at most the bill's "Overpaid"; (c) a group's master bill paid in cash is rounded to the rupee; (d) a cash refund is rounded to the rupee, the bill keeping the exact figure. (b), (e), (f) need no code.

**Shipped**
- (a) `refunds.ts` `refundBills`: the nights still to come are taken off the bill they post to (FIN-38), with a plain notice when nothing is left to refund before check-out.
- (d) Migration 227: `refunds.round_off` (±0.50, cash only) and `app.cashier_expected_cash` taking `amount + round_off` out of the drawer; the refund route works out the round-off, the line reads "Refunded - Cash (₹1,235.00 given, round-off +₹0.37)"; `cashier.ts` (the shift's receipts) counts it; the refund window shows "Cash to give" and "Round-off" (`flows/RefundStep.tsx`), the receipt "Cash given". The day reports keep the exact figure, as for payments.
- (c) `postings.ts`: the group's payment route passes `roundCash`; the group page's Settle shows the cash to take (`reservations/pages/GroupPanel.tsx`). Manual A2 (the host's account), rebuilt.

**Proved**
- Web types 0, API types 0. API (scratch database, through the queue): `refunds` 13, `masterBill` 9, `cashRoundOff` 4 - 26 of 26. Web: `refundStep` 5, `cashRoundOff` 4, `refundReceiptLink` 1 - 10 of 10.
- The three old faults put back at once (the limit, the refund's round-off, the master bill's `roundCash`): 3 failed, 19 passed; restored.

**Left open**
- The manual has no refund or cash round-off section yet (lane B's lines wait for `manual-rest`).
- (f) "Bank transfer" in each hotel's ways of paying: the owner or the GM, in Settings.

## 2026-10-15 · A deposit before arrival with the advance rule off (the owner's D27-330 (2), FIN-37)

**Asked for:** Settle opens before arrival for a deposit even when the hotel asks no advance; the amount typed by the desk, never filled in; held as the guest's credit. The whole session, with the screens and the tests, is front desk's CHANGELOG entry of the same date.
**Shipped:** `flows/FolioPanel.tsx` - `SettleDialog`'s `advance` is 0 before arrival when the server asks none (null only when not before arrival, or while the read is pending); with nothing owed it opens as "A deposit before arrival", the amount empty, credit without the tick. FIN-36's filled-in advance unchanged. `settleAdvance.test.tsx`: the deposit case (seen failing) and an in-house guard.
**Left open:** the refund banner "₹… is owed back to the guest." after money taken before arrival (a question for the owner).

## 2026-10-15 · A booking-site stay's refund for money paid at the hotel; Settle before arrival for the advance (the owner's D27-328 (2) and (3))

**Asked for:** D27-328 (2): a booking-site guest who paid the HOTEL and left early could not be checked out - the refund refused every booking-site stay. (3): the check-in asked for an advance "on the Bill tab" while Settle was grey before arrival and when in credit. The whole session, with what was seen and the test runs, is front desk's CHANGELOG entry of the same date.
**Shipped:**
- `api/.../refunds.ts` `refundBills` (FIN-35): a booking-site stay's bill offers the ways it was paid AT THE HOTEL, as a guest's own bill - the same four people, never "Bill to company" (city ledger is not a way money is given back), the same ₹20,000 cash rule and its transfer. The notice "A booking-site stay: the booking site refunds the guest..." stays only where nothing paid at the desk is there to give back. A company's credit unchanged.
- `flows/FolioPanel.tsx` (FIN-36): the Bill tab reads the advance still owed (front desk's `expressCheckIn`, the check-in's own read and cache key) for a booking not yet arrived; `SettleDialog`'s new `advance` opens Settle with it filled in ("₹… advance owed before check-in"), held as the guest's credit without the tick, "Advance owed" and "Remaining" against it; a part paid leaves the rest. With no advance owed it stays as it was.
- Tests: `api/test/modules/finance/bookingSiteRefund.test.ts` (new, property OTR), `settleAdvance.test.tsx` (new).
**Left open:** a company's credit to its City ledger at check-out (after launch; until then a manager reverses the payment the same day).
## 2026-10-14 · The release's API run: the reset clears refunds (FIN-34); the charge door's test reads lane B's refusal

**Asked for:** the master's helper on the final release copy: of the 9 API failures, two were finance's - `resetOrder.test.ts` ("refunds points at folio_postings and is not cleared") and `chargeDoor.test.ts` ("refuses a payment or a refund as a charge"). Fix each at its root, code or test. Branch `worktree-agent-a5f7c1ecdbb604327`, fast-forwarded to cp6 9ad852aa (lanes A, B and FD-32 merged).
**Found and fixed:**
- **FIN-34 (code):** 219 added `refunds` and not to `api/scripts/reset-property.ts`'s `CLEAR`; a reset of a hotel with any refund would have stopped on the foreign key and rolled back. `refunds` goes before `payments`. Every other reset path checked: the test hotel's (`app.test_hotel_clear`) works from 219's class list - right; load-demo drops the hotel, which cascades; `forbid_hotel_delete` refuses a hotel with postings; `demo-history.ts` clears only bookings it made, which have no refunds. No migration.
- **FIN-26's test (the test was wrong):** lane B changed the refusal to "A refund is not a charge. Give it with Refund on the bill." - right, a refund has its own step now and reversing the payment records no money going back. The test expected the old sentence; `DEFECTS.md` FIN-26 notes the change.
**Proved:** each file alone, seen failing first (resetOrder 3/4, chargeDoor 7/8), then 4/4 and 8/8; and in the one full API run (`npm test` through `.local/dbq.sh`, 19:34): 200 of 201 files, 2,687 of 2,691 tests - the 4 all `channel-manager/suAvailability.test.ts`, three 20 s timeouts and one count after them, in a file that ran before every file changed here (the run took 49 min on the loaded PC, the release's 22).

## 2026-10-14 · Cash to the rupee on a room bill (D27-317); a Refund line, and one sign for `refund` (D27-315 Part B) - Lane B

**Asked for:** `docs/briefs/lanes/money-roundoff-refunds.md`. (1) A room bill settled in cash: the cash taken is the nearest rupee, the round-off (at most ±0.50) recorded with the payment so the drawer balances; UPI, card and the rest exact; the GST invoice exact; the restaurant's Round off unchanged; shown on Settle and the bill. (2) A Refund line on a stay's own overpaid bill: the four of D27-125 only (server and database); back by the way paid, never cash for card or UPI; cash only below ₹20,000, a transfer above, until the CA confirms; mode, reference, reason, who, dated today; a cash refund lowers the giver's drawer; a plain Refund receipt; every report agreeing on what `refund` means first.
**Shipped:**
- `218_cash_round_off.sql`: `payments.round_off` (±0.50, cash only - a check refuses it on anything else); `app.cashier_expected_cash` adds it. `postings.ts` `takeFolioPayment`: a payer with `roundCash` (the stay route only) keeps `round(amount) - amount`; the line reads "Received - Cash (₹1,235.00 taken, round-off +₹0.37)"; the bill is credited the exact amount. `cashier.ts`: the drawer's cash receipts include it. Settle (`SettleDialog`, `roundCash` from the Bill tab only) shows Cash to take and Round-off when cash has paise.
- `219_refunds.sql`: `refunds` (way, label, amount, reference - required but for cash, reason, `refunded_by`, cash < ₹20,000), `app.may_refund` (owner, admin, GM, finance; a group administrator), a trigger on `folio_postings` (a refund line or its reversal only by those four - 42501; positive; only on a guest's own bill: never a group's master or a company-addressed bill), a trigger on `refunds` (its own refund line, same amount; the bill owes at most ₹0 after), a deferred constraint trigger (every refund line has its row by commit), the drawer (cash refunds leave the giver's drawer). `app.stay_bill`, `app.stay_charged`, `app.guest_voucher` copied with one change each: a refund is never a charge; paid is net of refunds.
- `refunds.ts` (new): GET `/:code/stays/:id/refunds` (may I, each bill's credit, notice, the ways and how much each may give back), POST (403 for anyone but the four; the ceiling counts cash already given back on the bill; a reference for anything but cash; the guest's payment turn; idempotency key; opens the giver's drawer for cash), GET `/:code/stays/:id/refunds/:postingId` (the receipt). `roleGate.ts`: the POST is `own`, the two GETs `BILLS`.
- One sign: a refund line is positive, money out, counted with the payments everywhere - `folios.ts` (the Folios list and the bill's figures), `billing.ts`, `cashier.ts` receipts, reports (`manager.ts` Payment by way net, Settlement by Guest net, never a charge; `nightAudit.ts` receipts negative by way, Checked Out's column "Refund", never a sale; `figures.ts` receipts; `reports.ts` cashier report and account ledger), `guests/directory.ts` spend. A refund line cannot be transferred, edited, or reversed except by the four.
- Web: `flows/RefundStep.tsx` (exported from the front door for the check-out dialog), shown on the Bill tab when the bill is overpaid: what is owed back, then a notice, who may, or Refund (ways and limits from the server, a reference box by kind, the ceiling and the Rule 51 sentence in plain words); `pages/RefundReceipt.tsx` at `/h/:code/stays/:id/refunds/:postingId`; the bill lists refunds with the payments ("Payments and refunds", Received and Refunded).
**Proved:** `api/test/modules/finance/cashRoundOff.test.ts` 4 failed on the old code (the drawer read 133.87 for 134) and pass; `src/modules/finance/cashRoundOff.test.tsx` 2 failed, 4 pass; `api/test/modules/finance/refunds.test.ts` 11 pass (roles 403, ways, ceiling, reference, drawer, the four reports moving alike, receipt); `refundStep.test.tsx` 4 pass; `db/tests/modules/finance.sql` round-off and refund checks. Numbers and gate runs: `.local/lanes/b-report.md`.
**Seen on screen** (scratch copy, made-up guests): Settle in cash and UPI, refunds by UPI and in cash, the receipt, Reception's notice and its 403; the drawer moved by the rupees taken and the cash given back. Found there and fixed: the refund step left the Bill tab once the bill reached ₹0, taking "Print the refund receipt" with it (`refundReceiptLink.test.tsx`, 1 failed before).
**Left open:** see the report - questions for the owner (among them a refund before the last night is posted), the Payments list, cash refunds with paise.

## 2026-10-14 · After a payment only that stay's bill and the open list refresh (the owner's D27-316 (2); front desk's entry has the whole session)

**Shipped:** `flows/FolioPanel.tsx` - `refresh` was `invalidateQueries()`; a write that changes only the bill now marks every read out of date (`refetchType: "none"`), asks again now this stay's reads, the bell, the Rooms board and Folios if shown, and writes this stay's balance into the In house and Due out rows from its own read (FIN-31). `refreshAll` (everything, as before) for Change rate, the late check-out and Check out. `data/folios.ts`: `listOpenFolios(hotel, stays?)` matches the folios to the stays a screen passes (the Calendar's window, D27-316 (1)); without them every booking, as Folios needs.
**Measured** (`fidato_d316`, a payment over In house): 36-37 reads, 21 a bill per row, settled 1.5-5.2 s after the payment → 9-11, 0.32-0.60 s.
**Proved:** `billRefresh.test.tsx` failed on the old panel ("another row's bill read again: stay-2") and passes; `checkOutFollowsBalance`, `settleOnce` pass.

## 2026-10-13 · Check out follows the balance on screen (the owner's D27-313 (1); front desk's lane)

**Asked for:** through the master, from the day check: the Bill tab's Check out greyed ~4 s after each payment with no reason. Done in front desk's lane (D27-313 (1)), finance claimed for it.
**Shipped:** `flows/FolioPanel.tsx` - the answer is `canCheckOut(stay, balance, money)` on the balance the panel already reads, not a query keyed on that balance (FIN-30). No bill is nothing owed, as before; no answer until the balance has loaded. `nextDestination.test.tsx` lost its mock of front desk's `checkOutAllowed`, which went. Six tests that draw the panel (`cashPan`, `onePress`, `overCreditLimit`, `overpayment`, `perBill`, `settleOnce`) now wrap it in `TooltipProvider`, as `AppShell` does: their API stub never answered, so Check out's reason - drawn in a tooltip - never appeared there before; it does now that the reason comes from the balance they stub, and a tooltip with no provider throws.
**Proved:** `checkOutFollowsBalance.test.tsx` - the stay read held open as a busy server held it; on the old panel both tests failed ("greyed with the bill settled"; "expected '' to match /800 is still owed/"), both pass.
**Left open:** nothing here. Front desk's CHANGELOG has the measurements.

## 2026-10-12 · No Send invoice on a group's master bill; its two writes say why offline (the owner's D27-307 (4))

**Asked for:** the master: Send invoice on a master bill's tax invoice could
only answer "It has gone to the guest by email already, or the guest has no
email address" - nothing sends it (`app.guest_invoices_owed` reads a stay's
bills only). Hide it. And POST /groups/:id/payments and /groups/:id/invoice
got the generic offline refusal.

**Shipped:** `invoiceFacts` (`api/.../invoices.ts`) answers `masterBill`
(the invoice's folio has a `group_id`); `InvoiceDetail.masterBill?`; the
Invoice page draws no Send invoice when it is true. `src/lib/offline.ts` (the
core, the master's exception): the Payment and Invoice rules match
`/groups/:id/payments` and `/groups/:id/invoice`, so each gets that rule's
sentence. MODULE.md's invoice row says so.

**Proved:** web `testHotel.test.tsx` "and is not offered on a group's master
bill" and `src/lib/offline.test.ts` "refuses a group's payment and its
invoice" failed on cp6 (Send invoice drawn; "This change"), pass on the fix.
API `masterBill.test.ts` (the master's invoice says `masterBill: true`) and
`invoices.test.ts` (a stay's says `false`) both failed with cp6's
`invoices.ts` (undefined), pass with the fix. Opened the demo's master invoice
5EL/2026-27/00001 as the GM on a scratch copy: Cancel this invoice and Print,
no Send invoice.

**Left open:** a banquet function's tax invoice has the same fault (its
folio has no stay either) - asked, not changed.

---

## 2026-10-12 · Settle the master bill (the owner's D27-305 (10))

**Asked for:** on the group's page, settle a group's master bill ("Host pays") the way a stay's bill works - a payment in any of the hotel's ways, its tax invoice from the same series (a company's not sent by itself, D27-284), and "Bill to company" to the company's City ledger with its credit limit counted across the group (D27-279) and the GM's "Allow, with reason" - through the stay's own paths, not a second money path.

**Shipped:**
- `POST /:code/groups/:id/payments` (`postings.ts`): the group's open master through `takeFolioPayment`, in the group's turn (`payment-group:<id>`, as its rooms' payments), cash counted over the group's bills (the master's and its rooms'), a foreign lead guest not asked for a PAN. The door gains `Payer.check(method, amount)`, the caller's own last refusal (it may write): for the master, "Bill to company" refused when the master names no company, else `overCreditLimit` with `overLimitReason`. A stay's payment is unchanged.
- `POST /:code/groups/:id/invoice` (`invoices.ts`): `issueFolioInvoice` on the master, to the company it is addressed to, else the guest who leads the group, else the group's name. `app.guest_invoices_owed` reads a stay's bills only, so it is never sent by itself.
- The master is addressed to the company when the host account opens (reservations' `groups.ts`), so the City ledger and `app.company_owes`, which read the bill's own company, count it unchanged. No migration.
- `roleGate.ts` (core, two lines): payments `PAYMENT`, the invoice `TAX_INVOICE`, as a stay's.
- Web: `SettleDialog` takes `pay`, `payer`, `primary` and `credit` and shows the over-limit sentence and the GM's reason box (Add charge's); exported with `IssueInvoiceDialog` (Invoices' "Issue this tax invoice?", moved to `flows/`, Invoices uses it), `settleGroupBill`, `issueGroupInvoice`.

**Proved:** `api/test/modules/finance/masterBill.test.ts` 8/8 (addressed to the company; a Viewer and housekeeping refused 403 for a real group and a made-up id alike, nothing posted; UPI ₹1,300 taken, a method the hotel does not take refused; no amount refused; over the limit refused with `needs`, reception's reason refused and no allowance written, the GM's allowed and audited, the company owes ₹5,000; a group billed to nobody refused; the invoice 00001 to the company with its GSTIN and address, a second press the same number, not owed to any guest; a family group's to its lead guest). With `Payer.check` switched off 3 of 8 failed. `roleGate.test.ts` 79/79. The finance, banquet and reservations API folders: 35 files, 242/242. `groupMasterBill.test.tsx` 6/6; with the over-limit branch broken 2 failed, with "still staying" dropped 1 failed. `db/tests/modules/finance.sql`: three checks (a master's transfer owed by its company; its invoice not owed by itself with the switch on, nor by Send invoice); `db/tests/run.sh` all 1,668 passed. Quick gates: types and strip 0; web 1,227 of 1,229 - the two (`App.test.tsx` module switches, `newBookingFields`) timed out under other helpers' load and passed alone (33/33, 1/1). Opened on the local demo: a two-room company group, host account opened and both rooms ticked on the page, checked in (two nights, ₹6,300, on the master), ₹1,300 by UPI on Settle, ₹5,000 "Bill to company" refused over the ₹2,000 limit and allowed by the GM with a reason, both rooms checked out, the master left open (₹0), Issue tax invoice took 5EL/2026-27/00001 to the company; City ledger debit ₹5,000. At 390 px no sideways scroll.

**Left open (questions for the owner):** in the master chat's report of 12 October.

## 2026-10-05 · The credit limit counts the whole group; the interim bill is guarded (the owner's D27-279 (6), (8))

**Shipped:**
- Migration `203_company_owes_across_the_group.sql`: `app.company_owes(company)`, a definer returning one number, the City ledger's closing balance for the company summed over every hotel (bills sent "Bill to company" still standing, less its payments, each up to its hotel's business date). `creditLimit.ts` asks it instead of this hotel's moves, so reception at one hotel is answered for the group.
- `routes.tsx`: the interim bill (`/h/:code/stays/:id/bill`) is in `RequireAccess`, which takes In house's rule (D27-275's `entryFor`).

**Proved:** `db/tests/modules/finance.sql`, three checks (nothing owed, 1,500 + 2,500 - 1,000 across two hotels with a reversed transfer left out, reception at one hotel answered 3,000); `api/test/modules/finance/creditLimit.test.ts` adds a ₹2,000 bill at Agra that tips a ₹1,000 charge here, failing before 203 is asked, passing after. `RequireAccess.test.tsx`: the chef refused a stay's bill by In house's name, reception let through; both refusals failed before the guard. Opened in the browser on the copy's own database: the chef saw "which does not include In house", reception the bill; the booking page as reception and as the GM, the GM's allow booked it and the allowance names the Test GM.

## 2026-10-04 · A company over its credit limit (the owner's D27-275 part 5)

**Asked for:** a booking or charge billed to a company whose outstanding plus this amount is over its `credit_limit` is refused, "<Company> is over its credit limit by ₹x."; the owner, an administrator or the GM may allow it with a reason, kept in the activity log; no limit, no check.

**Shipped:**
- `creditLimit.ts`: `overCreditLimit(client, hotel, company, amount, { reason, title })`, the one check. Outstanding is the City ledger's own moves for that company at this hotel up to the business date (`cityLedgerMoves`, opened on reports' front door; no second sum). Refused: `{ reason, needs: "credit-limit" }`. Allowed: a row of `credit_limit_allowances` (migration 199, audited, insert only for `app.manages_hotel`), which the Activity screen lists as "Over the credit limit".
- `postings.ts`: `postCharge` (the desk, laundry and spa) and `postFolioCharge` (banquet) ask it last among their refusals, for the company the bill is addressed to (`RECIPIENT_COMPANY`), with the charge's GST. `ChargeToPost.overLimitReason`; the charges route passes it and answers `needs`.
- Web: the charge dialog shows the sentence; for the owner, an administrator or the GM a "Why it is allowed" box, and Post charge becomes "Allow, with reason". `OperationResult.needs` (core `src/data/repositories/result.ts`) gains "credit-limit".

**Proved:** `api/test/modules/finance/creditLimit.test.ts` (no limit, under, outstanding counted, reception refused and its allow refused, a blank reason refused, the GM's allow logged with the actor, a booking refused writing nothing and allowed by the GM): three failed before the change. `db/tests/modules/finance.sql`: four checks on the table (reception refused by the policy, the GM writes, the audit names them, no update or delete). `overCreditLimit.test.tsx` (web): both failed with the dialog's branch broken.

**Left open (questions for the owner):** the balance is this hotel's City ledger, though the limit is the group's (C-9); a group balance needs a database function. A booking counts its nights with the room's GST, a hotel with no GST rule counting none. Laundry, spa and banquet charges are refused too, with no allow on their screens. The till's room charges do not pass this door and are not checked.

## 2026-10-04 · Tax by date and a SAC on each invoice line (P3, the owner's D27-258 Q6/Q7; finance claimed by the rates lane)

**Asked for:** tax rules valid from and until a date, one band's periods entered in advance, and a SAC per service printed on each invoice line, with rooms keeping 996311 and the others a dash until the CA gives their codes. Branch `settings/rates-3oct`.

**Shipped:**
- Migration 197: `tax_rules` keyed with `valid_from`; `gst_rate_or_null` uses the hotel's business date (same signature); `folio_postings.tax_kind`; `invoices.sac_by_kind`.
- `postings.ts`: postCharge keeps its taxKind; a corrected charge keeps the original's.
- `invoices.ts`: issue freezes each kind's SAC from `tax_sac`; each line gets a `sac` (`sacOf`).
- `tax.ts`: `PUT /tax/:kind` takes per-slab `validFrom`/`validTo` and refuses overlapping periods of one band; `PUT /tax/:kind/sac`; `GET /tax` gives both.
- Web: the tax card shows "from"/"until" and each kind's SAC; the invoice print has a SAC column.

**Proved (each failed first):**
- Database: one stay's 21st on the old rate and 22nd on the new.
- API `invoiceSac`: the bar and the restaurant keep their kinds; an issued invoice keeps its codes after `tax_sac` changes; old invoices print 996311 on room lines and a dash on the rest.
- Web: the SAC column; the tax card's dates and SAC.
- Other lanes' tests changed for the wider key: `db/tests/suite.sql:46` and `api/test/modules/laundry/laundry.test.ts:412/440` now use `on conflict do nothing`; `api/test/modules/finance/stayBill.test.ts:65/68` deletes, then inserts.

---

## 2026-10-03 · Money in the settings console: payment methods, extra charges, % or ₹ discounts, commission, pickup and drop (the owner's D27-259) - P4, the cash lane

Branch `settings/money-3oct`. **Asked for:** phase 4 of the settings plan; the owner took every recommendation (D27-259 Q1-Q6).
**Shipped:** migration `191_money_settings.sql` - `payment_methods` per hotel (the word, what it is in the books, On/Off, order; seeded with the five the screens offered, new hotels too; triggers keep the default On and carry it through a rename), `payments.method_label`, `inclusions.is_transport`, `room_promotions.amount`, `reservations.discount_amount`. `money.ts`: GET/POST/PATCH/DELETE/order for payment methods, extra charges (the inclusions list) and discounts, the default, commission. The payment door takes only a method that is On and keeps its word ("Transferred to city ledger - Agoda"). Pages registered in `money.settings.ts` (money/payment-methods, extra-charges, discounts, commission, pickup) on one shared list (`MoneyList`: search, add, drag to order, On/Off, edit, delete only when unused, a plain-words panel in each editor). The bill's Add charge picks from the list; the screens' payment lists come from GET /api/hotels (`payingWays`, the starting five when an older server sends none). A payment from before 191 kept no word, so it counts against every method of its kind: such a method is switched Off, never deleted.
**Proved:** API `money.test.ts` (payment methods, the door, the default, extra charges, discounts, commission) and `newBooking.test.ts`'s ₹ cases; each of five guards removed made its test fail (the door's On check, the default's trigger, the 10% cap, the payload's On filter, delete-when-used). Folders: finance 130, reservations 56, banquet 41, inventory 84, front-desk 101. Web `moneySettings.test.tsx`, `frontDeskRules.test.tsx`.
**Left open:** the activity log does not see a change of default (hotels has no audit trigger - as Front desk rules today); migrationNumbers fails on the 190-191 gap until the master renumbers.

## 2026-10-02 · Company payments in the City ledger (the owner's D27-239); a cash paid-out waits for the GM's or owner's yes (D27-242)

Branch `finance/cityledger-expenses-2oct`, the cash lane. **Asked for:** the master, with the owner's answers: (1) a company's or booking site's payment recorded and reversed on Company accounts, and the City ledger's Opening, Credit and Closing counting it; (2) every cash paid-out - the desk's drawer and an outlet's tin - waits for the GM's or the owner's approval; (Q4) the accountant's day book shows company payments as receipts, apart from sales, ready for Tally.
**Shipped:** migration `187_company_payments_and_cash_expenses.sql` - `company_payments` (append-only: insert and select only; one account, a company or a booking source; a reversal is its own negative line, once, with a reason) and a `cash_expense` approval rule on every property, new ones too (the GM decides, the owner also; nobody their own - the engine's 076 rule); `app.cash_expense_counts` decides in the database whether a paid-out counts, and `app.cashier_expected_cash` / `app.pos_expected_cash` take it off only then. `companyPayments.ts`: GET/POST `/company-payments`, POST `/:id/reverse` (record: owner, admin, GM, hotel manager, front desk, finance; reverse: D27-125's four - `roleGate.ts`, pinned). Cashier: a paid-out raises its approval; the drawer shows "Waiting for a yes", leaves it out of Expected, and the close asks a reason only for what the waiting paid-outs do not explain. Company accounts: Opening, Sent, Received, Balance, "Record payment" and a received list with Reverse. Through other services' doors: the reports' `cityLedger.ts` and `manager.ts`, POS `till.ts`/`DayEnd.tsx`, accounting's day book (their changelogs).
**Found:** FIN-28 (reversal answered 500: `FOR UPDATE` on an insert-only table).
**Proved:** API `companyPayments.test.ts` and `cashExpenses.test.ts`; web `companyAccounts.test.tsx` and `cashExpenses.test.tsx`. Each guard removed, its test failed: the tin's approval not raised → the tin case; the close's rule without the waiting paid-outs → "asks a reason at the close" (and the web test: the "Why" field shown); the reversal filter in `companyReceipts` → the reversal case; Opening never counting the past → the ledger case; the drawer's approval not raised → "waits for a yes"; the Manager report's Payment Received emptied → the ledger case; `app.cash_expense_counts` always true → "waits for a yes" and the tin case (5 of 6 failed). Runs: `test/modules/finance` 20 files, 121 tests, passed; `test/modules/accounting` with roleGate and resetOrder 97 passed; `test/modules/reports` 33 passed; `test/modules/pos` 224 of 225, the one being `till.test.ts`'s old "money out comes off at once" (updated to D27-242; then 84 of 84); web: primaryAction, navigation, boundaries, migrationNumbers and the finance, accounting and pos folders, 43 files, 213 tests, passed; `npm run strip-check` 192 files. Screens at desktop and 375 px: Company accounts (record ₹1,000 from Expedia, Reception sees no Reverse), Cashiering (₹200 waiting), Approvals (the GM approves it), the Accounting export (as the Accountant), Close restaurant day (₹150 waiting, Expected unchanged).
**Left open:** the Approvals page's empty text names only purchases and equipment; the Dashboard's City ledger tile note still says "Shows a dash until company payments are recorded" (both core - told to the master).

## 2026-10-01 · The room's own fees under Room on the bill (the owner's D27-223); the bell by the guest's own bill (D27-226)

Branch `fix/fees-dayuse-1oct` from cp6 9a9e7a3b, the booking and bill lane. **Shipped:** the desk's early check-in and late check-out fees are posted with their own source (`early_checkin`, `late_checkout`, front desk's check-in and check-out) and `sections.ts` puts a misc line with either source under Room; the postings route sends `source` (through a closed-day correction to its origin, the night audit's `ORIGIN`; a reversal takes its line's), and `app.stay_bill` carries it on the printed bill - migration `175_bill_lines_say_where_they_came_from.sql` (same jsonb, one key). Lines before 1 October say `front_desk` and stay in Other charges. **The reports do not move**: they read the category, and these stay `misc` (the owner, through the master). **Corrected:** the D27-200 entry below said "extra person fees" sit under Other charges - there is no such posting; the extra adult or child is priced inside the room rate, so it was always the room's. The bell (core `api/src/routes/notifications.ts`, the master's yes): "outstanding" and "to refund" count the guest's own bills (D27-226). **Proved:** web `billSections.test.ts` (fails on the old `sections.ts`); API front desk's `feesAndDayUse.test.ts` and `notifications.test.ts`, each failing on the old code.

## 2026-10-01 · A guest's own figures count only the guest's own bill (the owner's D27-226, FIN-27)

Same branch. **Shipped:** `FOLIO_SELECT` counts a line for the bill it is on (the stay's folio, or the group's master) - GET /stays/:id/folio, Settle's unnamed `owed` and the night audit's owing count with it; GET /folios lists a group's master bill once, named for the group; the Folios page shows "Group bills" and counts them. **Proved:** 4 API cases and 1 web case, each failing on the old code. **Told the master:** the notifications' fourth copy (core).

## 2026-10-01 · Three fixes from the pre-launch review: nights to come by the audit's rule, the invoice's odd paisa, no payment through the charges route (FIN-24, FIN-25, FIN-26)

Branch `fix/review-1oct` from cp6 7ada2983, the booking and bill lane, from the master's read-only pre-launch review. **Shipped:** the Bill tab counts no nights itself - `GET /stays/:id/bill` returns `nightsToCome`, by the night audit's own rule, and none for a room billed to its group, so the headline and the panel's foot no longer show a Due the company pays (FIN-24, which also closes the reversed-night case). The tax invoice splits CGST and SGST in whole paise with the odd paisa to CGST, as the bill does - **only invoices issued from now on** (FIN-25). The charge door refuses "Payment" and "Refund" (FIN-26). **Proved:** each case fails on the old code first - web `chargesToCome.test.tsx` (2 new), API `invoices.test.ts` (1 new), `chargeDoor.test.ts` (1 new), front desk's `firstNight.test.ts` (3 new). **Left as it is:** a per-rate paisa difference between a bill and its invoice (FIN-25).

## 2026-09-30 · The printed interim bill shows tonight's night "to be posted tonight" (D27-204); a stay's room night on its group's bill (FIN-23)

Branch `fix/booking-bill-30sep`, the booking and bill lane; the master approved the plan and the layout, the owner's answers are D27-205. The whole account is front desk's CHANGELOG, same date. **Shipped:** `GET /:code/stays/:id/bill` (`folios.ts`) adds `tonight` - the night audit's own answer for this stay (`roomNightsDue`), so the rule, the rate and the GST are the ones the run will post; `app.stay_bill` untouched, no migration, the guest's own page unchanged. `flows/BillPrint.tsx`: under the Total - Paid, "To be posted tonight · Room 302 · 1 night, with GST 5%", and "Amount due" (the balance plus that night and its GST, in paise); the posted sections and totals do not change; with no such night it prints as before ("Outstanding"). `flows/FolioPanel.tsx`: the charges-to-come box says "The first night is posted at check-in, each later night by the night audit." `postings.ts`: Edit and Reverse find a stay's own room night on its group's bill (FIN-23); `editFolioCharge` on the front door for the front desk's move. **Proved:** `billPrint.test.tsx` 10 passed, 2 new - the row and the amount due fail on the old component; the API cases are front desk's `firstNight.test.ts` (the bill's `tonight` after the audit, none on the arrival day; Change rate for a room on the group's bill fails with `postings.ts` put back: "Posting not found"). **Screens**, desktop and 390 px: the interim bill on 1 October - Total ₹4,725.00, Paid ₹0.00, "To be posted tonight · Room 302 · 1 night, with GST 5% ₹4,725.00", Amount due ₹9,450.00; no sideways scroll at 390. **Left open:** FIN-24 (the Bill tab's box and a night taken off).

## 2026-09-30 · The bill in sections: Room, Restaurant, Bar, other charges (D27-200)

Branch `fix/booking-bill-30sep`, the booking and bill lane; the master approved the sketch and the owner's four answers. **Shipped:** `sections.ts` - the one rule for where a line sits (its category and its tax scheme, never its words: VAT is the Bar's, `room` is Room, `food`/`beverage` under GST are Restaurant, the rest Other charges, "and adjustments" with a discount or a loose tax line) and what a section comes to (its lines added, in paise). `flows/FolioPanel.tsx` - the Bill tab draws the sections, each with its lines, subtotal and tax, then Total charges, Payments received and the closing row (the headline's figure); the charges-to-come box sits under Room; a reversed line stays struck through with its reversal right under it; a line shows its amount before tax to the paisa; the running balance under each line went (the owner). `flows/BillPrint.tsx` - the printed bill (and the guest's page, which prints the same) in the same sections, the server's totals unchanged. Migration `166_bill_lines_say_their_scheme.sql` - `app.stay_bill`'s lines gain `scheme` (same jsonb, no figure touched); the postings route sends `scheme` and `rate`. **Found:** a payment and its reversal summed to minus zero ("-₹0.00"), fixed. A posting carries no tax KIND, so the desk's early arrival, late departure and extra person fees (category misc) sit under Other charges; under Room needs the kind stored (the master, after the launch). I reported that a reversal loses its line's tax scheme: WRONG - 125's trigger `folio_postings_reverses_its_tax` sets it; the failing-first test passed on the unchanged code and nothing was changed. **Proved:** billSections.test.ts (all four sections and a reversal add up to the old total, 9,204.50); billPrint, billControls (FI-6 carried into the sections), chargesToCome - the screen cases fail on the old screens; stayBill API 3/3 (fails without 166). Screens, desktop and 390 px: the Bill tab with all four sections (total charges ₹1,906.50, Due ₹4,905.50 in the headline, the closing row and the panel's foot); the interim bill with Restaurant, Bar and Other charges coming to the server's Total ₹1,906.50.

## 2026-09-30 · The bill's headline is what is due; Change rate's "Includes GST" tick (D27-199)

Branch `fix/booking-bill-30sep` (cp6 0ee4d792 merged in), the booking and bill lane, from the owner's own screenshot. **Shipped:** `flows/FolioPanel.tsx` - while charges are to come the Bill tab's headline is "Due" with them counted and "Received" under it (the owner's bill said "₹1,001 Overpaid" above a box saying ₹2,882.95 was due); Overpaid or Settled only when the money received covers them too; one hook (`useChargesToCome`) feeds the headline and the box; nothing is posted early. `ChangeRateDialog` gets an "Includes GST" tick: the split shown before saving (or the paisa sentence, or the slab-gap refusal with the button held), `includesGst` on `POST /stays/:id/rate`, which splits with `roomRateBeforeGst` before `changeStayRate` keeps it; the notes line keeps the typed figure ("→ ₹4,000.00 incl. GST: why"). **Proved (each failing on the old code first):** chargesToCome 2/2, rateBeforeArrival 3/3, changeRateBeforeArrival 3/3. Screen, desktop and 390 px: the owner's case at the all-in list price - "Due ₹2,698.00, Received ₹1,001.00"; Change rate to ₹4,000 all-in kept 3,809.52 and the headline moved to ₹2,999.00. **Left open:** the stay panel's foot still reads the posted balance ("In advance ₹1,001"); the In house list, the Folios page, the interim bill and check-out stay on the posted balance by design - the question is with the master.

## 2026-09-30 · Booking and bill (D27-187, D27-193)

Branch `fix/booking-bill-30sep`, the booking and bill lane; the whole account is reservations' CHANGELOG, same date. Here: the bill shows the charges to come - nights not posted x the agreed rate, GST by the slab rounded a night, the balance due once posted with the advance counted - marked not posted, nothing posted (chargesToCome). The front door gains `ChangeRateDialog` (the panel's Change rate before check-in) and `getCashierDrawer` (read only, the one page's cash advance). Change rate's toast no longer says "from tonight" when nothing is charged. D27-195: `roomRateBeforeGst` in `tax.ts` (a room rate that includes GST, split on the pre-tax slab, the nearest total not above the figure, the slab gap refused) with `GET /:code/tax/room/before-gst` (anyone, pinned) and `getRateBeforeGst` on the web front door (inclusiveGst 5/5); `changeStayRate` keeps a rate change's reason in the booking's notes when no night is charged (rateBeforeArrival 1/1).

---

## 2026-09-30 · The cash lane, second round: cash opens by itself after the night audit (D27-200, D27-201, D27-202, FIN-22)

**Asked for:** the owner, after the hotel's supervisor: "after the night audit, the new register is open, the new cash thing is open … we don't need to open the thing separately." It replaces D27-190/191's count-in and "no cash before"; the closing count, its reason, the float kept and the deposits log stay. Branch `cash/counts-deposits-30sep` on cp6 9d6e084f; `fidato_s47`, API 8907, web 5307.
**Shipped:**
- **The desk opens by itself** (`openOwnDrawer` in `cashier.ts`): a person's first cash payment, or first money in or out, opens their drawer - on the float handed to them BY NAME (`app.cashier_float_waiting`), ₹0 for anyone else. Never on a read: an open drawer must be counted before the audit. `postings.ts` (two hunks, the master's yes): the "Open your cash drawer first" refusal is gone and the opening runs after every refusal, in the payment's own transaction.
- **A float is carried once**: `cashier_float_claims` (165) - the primary key is the close. Openings and handovers take turns per hotel (an advisory lock), so a handover is either seen by the next opening or added to the drawer already open (the shift-overlap case, D27-201).
- **The close** (D27-201, D27-202): the float kept is always typed, 0 up to the count; above 0 it names the next person and waits for them; the rest is to deposit. To hand everything over, the whole count is typed.
- **Both ends on record, and shown** (the owner: "what comes is what goes"): Cashiering's closed view says the last close's count, float kept, for whom and the amount to deposit; an open drawer says the float it took and from whose close (FIN-22 fixed on the way).
- **The counted open stays** as it was: how a desk's first float gets in. What was handed to the person is taken up by it, never added on top.
- The till: pos's CHANGELOG.
**Proved:** API `cashOpens.test.ts` (new) 6, `cashCounts` 7, `cashDeposits` 8, `billControls`' flipped test - each new guard seen failing with it removed, one a round (the waiting float, the payment's opening, the claims, the add to an open drawer, the counted open's take-up, the name rule, the money-in opening, the till's carry). On screen (`fidato_s47`): a cash payment from the Bill tab with no drawer open was taken and the drawer stood open at ₹0 with ₹890; ₹500 kept with nobody named held the close, naming Test GM gave "To deposit: ₹390.00"; the GM read "₹500.00 was handed to you", and after their first cash "₹500.00 from Test Reception's close" and ₹600 expected.
**Left open:** reception's Start here card (core) still describes opening the drawer by hand. A float handed to a named person waits for that person; if they do not come in, whoever works starts at ₹0 and counts over by it, with a reason. A close that kept a float with nobody named, made before D27-201, is never carried.
**Commits:** 45c21be9 and the next.

---

## 2026-09-30 · The cash lane: count in, count out, and the Cash deposits log (D27-190, D27-191, FIN-21)

**Asked for:** the owner's D27-190, with the details the owner took on the lane's recommendations (D27-191). Branch `cash/counts-deposits-30sep` from cp6 c01b150, copy `.claude\worktrees\suspicious-germain-e18615`, database `fidato_s47`, API 8907, web 5307. Finance worked under the contracts lane's paused claim, by the master's leave; no bill file touched (postings.ts, FolioPanel).
**Shipped:**
- **Count in, desk** (FIN-21): the float is counted on the note grid the close uses; a blank float is refused (0 only when typed). Cashiering does not open until something is counted.
- **Count out, desk:** Close and hand over asks "Float kept for the next shift" (0 to counted) and shows To deposit; a handover keeps the whole drawer (nothing deposited from that shift). `cashier_shifts.kept_cash`.
- **The restaurant** (pos's files, the master's yes): Open the day, no cash before it, the float kept at its close - pos's CHANGELOG and POS-29.
- **Cash deposits** (`/h/:code/cash-deposits`, Finance section; `api/src/modules/finance/deposits.ts`; migration 163): each closed day's cash to deposit per cash point (`app.cash_to_deposit`: counted less the float kept, plus To the safe, less Cash in from the safe), deposited, the difference red until explained; Record deposit (the day it banks, amount, date, bank, slip number, the slip's photo through the shared attachments route); Explain; Verify (owner and accountant only; refused without the photo or on a red day); Reverse (a line of its own, once, never after verification). Record, reverse, explain: owner, Admin, GM; see: those, the accountant and the Viewer; not reception, not the hotel manager. Append-only in the database: insert and read only, the verification stamp once (trigger). The log starts from the release: a day whose closes kept no figure is not listed; a figure that is unknown is a dash.
- roleGate: the five deposit routes as `own` (the route asks the role); `api/scripts/reset-property.ts` clears the two new tables.
**Proved:** API `cashCounts.test.ts` 5 and `cashDeposits.test.ts` 8 - each guard seen to fail with it taken out (the roles, the release rule, the float kept, the safe, the photo, the red day, the explanation's time, reversing a verified deposit, the append-only grants and trigger). POS folder 18 files 190 passed; finance, roleGate, resetOrder, reports, night audit, attachments 23 files 234 passed. Web pos + finance + src/test + components: 187 passed, 1 failed (migrationNumbers: the numbered-for-now gap, renumbered 163 at merge). tsc -b, api tsc, strip-check clean. On screen (`fidato_s47`): Reception opened a drawer on 4 x ₹500, counted ₹2,500, closed with a reason and ₹1,000 kept ("To deposit: ₹1,500.00"; the row reads kept 1000.00); Close restaurant day showed Open the day, a dash for the float and "Open the day first" before it, the till refused cash in words, then opened on ₹2,000, took ₹336 cash, counted ₹2,336 to balance, and Finalize read "To deposit: ₹1,836.00" for ₹500 kept (not closed: six demo bills were open). Cash deposits, on two seeded past days (24 Aug with the float kept, 23 Aug without): the GM saw desk ₹12,500 + restaurant ₹5,000 = ₹17,500 and not 23 Aug, recorded ₹15,000 with a slip photo, explained the ₹2,500; the accountant verified it and opened the photo; Reception has no menu entry and the address shows the server's sentence. At 375 px no sideways scroll.
**Left open:** Close restaurant day serves one outlet (REST) as before; a second outlet has no page of its own. Deposits on days before a close's float was recorded are not listed (D27-191's start). Photos can be attached by anybody holding `purchasing` create (the shared attachments rule); only the owner and accountant verify.
**Commits:** 0cadb22, c9ba2b4, and this one.

---

## 2026-09-29 · The folio lane: Edit a charge, Change rate, no reversal after a tax invoice, one payment taken once (D27-157, D27-162, FIN-19, FIN-20)

**Asked for:** the owner's D27-157 and its details D27-162, and the speed lane's finding 7. Branch `folio/edit-29sep` (from cp6 ca02e37, round F's `fix/leftovers-28sep` merged in), copy `.claude\worktrees\nervous-spence-42dcae`, database `fidato_s31`, API 8871, web 5271.
**Shipped:**
- **Edit** (`editFolioCharge`, `POST /stays/:id/charges/:postingId/edit`; the Bill tab's pencil): owner, administrator, GM. The old line reversed through `reverseFolioCharge` with the reason, and the corrected one posted on the same bill and date, keeping its heading, tax scheme and source (a restaurant line stays the restaurant's). A room night: price only (its words count its nights), tax by the slab on the price a night; any other line keeps its rate (D25-9). Refused: a closed day, a standing tax invoice, drinks with a VAT bill, a price of 0. The pencil is off, with the reason, on a closed day or an invoiced bill (the bill's read now says `dayClosed` and `invoice` per line).
- **Change rate** (`changeStayRate`, `POST /stays/:id/rate`; the Bill tab's button): the stay's `agreed_rate`, and every live room line corrected to rate x its nights - a closed day's through night-audit's `correctClosedCharge`, an open day's through Edit. All or nothing under a savepoint; the refusal names the night. A rate of 0 refused.
- **↺ after a tax invoice** (FIN-19): a charge or discount refused ("Only a credit note corrects it now"); a payment or refund still reversed by the four money roles (D27-125).
- **Settle** (FIN-20): the amount cleared on success; `settle()` no longer re-reads the bill after the payment.
- `roleGate.ts` `EDIT_BILL` (the master's delegation) and `"stay-bill"` in `src/lib/freshness.ts` MONEY_KEYS (the master's delegation: the Interim bill re-reads when opened).
**Proved:** web finance 17 files, 65 passed, `editCharge.test.tsx` and `settleOnce.test.tsx` seen to fail without their fixes; `freshness.test.ts` seen to fail without "stay-bill"; tsc -b and api tsc clean. API `editCharge.test.ts` 4 passed; with the ↺-invoice guard and Edit's per-night slab taken out, 3 failed ("expected '18.00' to be '5.00'", the reversal let through, Change rate not refused). After merging cp6 2fac3e8: `till.test.ts` + `roleGate.test.ts` 143 passed; web pos + finance + src/test 150 passed. On screen (`fidato_s31`, Owner): Edit ₹3,690 → ₹3,500 on Tanvi Bhide's restaurant line (reversal with the reason, the new line `pos`, 5%); Change rate ₹8,000 on her stay ("Room 201 · 2 nights" → ₹16,000 + 18%, agreed_rate 8000); Settle UPI ₹2,957.46 on Ananya Bose's stay, the closing dialog "₹0 outstanding / Paying ₹0" with no credit offer.
**Left open:** Edit shows no figure for the new tax before the press (the bill shows it after); Change rate lists no night-by-night preview; a group master folio's lines are not on a stay's Bill tab and so not editable there; an outside till's void of a bill edited at the hotel answers "already taken off" while the corrected line stays; the desk's Add charge of a several-night "Room" line still asks the slab on the whole amount (postCharge; the walk-in and the audit ask per night).
**Commits:** c48d0a8, 94433a2, 10b015b, a6ac53b, d9c7c41, 6150bae, 5e606c3; merge 5053764.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part C: one reversal for a function's bill too; Reversed in words; the place once; Company accounts and Cashiering as the server asks (D27-154, QA FI-18, FI-16, D27-145, RO-4)

**Asked for:** the master's part C, after round A merged; finance claimed for these only. Branch `fix/leftovers-28sep` (cp6 6686af1, round A, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:**
- `reverseFolioCharge(client, hotelId, postingId, reason, within)` on the front door: round A's reversal moved into a function unchanged (reason required, D27-117; a payment only by the money roles, D27-125; closed days refused) and the ↺ route calls it, so there is one insert for a reversal. `within` is the stay's bills or one folio. Used by the banquet's reopen (D27-154).
- FI-18, Payments: a "Reversed" pill beside the method, and the note says "marked Reversed" (strike-through only before). FI-18's "₹784over" is front-desk's `StayTable.tsx`: part D.
- FI-16: `placeLine` (round A's) on the front door; the admin Properties list and a property's page use it. The guest's interim bill already prints the town once.
- D27-145: Company accounts' entry and route declare `invoice` (they said `commission`; the entry's own rule already kept the revenue manager out).
- RO-4: Cashiering's entry asks `payment` create, the server's DRAWER rule: the Viewer no longer finds it in the menu or search; the page is not guarded, so it still reads by address (D27-146).
**Proved:** api `billControls`, `alcoholVat`, `auditLog`, `corrections`, the banquet tests and `roleGate.test.ts`: 11 files, 152 passed (the reversal's own tests unchanged). Web finance + navigation 16 files, 79 passed. On screen: Payments "UPI Reversed … ₹10" after a reversal through the route, and "1 receipt is marked Reversed"; Properties "Akkalkot, Solapur District, Maharashtra 413216".

---

## 2026-09-28 · QA fix round A: money and bills (branch `fix/money-28sep`)

**Asked for:** the owner's D27-116 - every BLOCKS WORK and WRONG RESULT in the QA's finance table (docs/qa/qa-2026-09-28.md) before the release - with D27-117 ("Are you sure?" before reversing, issuing an invoice number, check-out) and D27-118 (cash only into an open drawer). The owner answered three more here (D27-125 to D27-127): a payment is reversed only by the owner, an administrator, the GM or the accountant; the interim bill prints the exact figure, no round-off; Company accounts shows the City ledger report's figures.

**Shipped** (each with a test seen failing on the old code, and the screen used):
- FI-1, FI-2, FI-3, FI-7, FI-15 - one bill at a time: payments and invoices by `folioId`, one Invoices row per bill with "Billed to", Settle on the open tab's bill, "Issue this tax invoice?" naming the party and the number. The per-bill door for round E's function bills: `takeFolioPayment`, `postFolioCharge`, `issueFolioInvoice` (with `sac`), `folioBalance` (FIN-15).
- FI-4, FI-5, FI-6, FI-11 - no minus charges; reversal with a required reason, payments for the four managers; the running balance; the charge preview and toast (FIN-16).
- D27-118, FI-10, FI-12 - cash only into an open drawer; whole-note counts; 22003 → a plain 400 for every route (FIN-17).
- FI-8, FI-9, FI-16 - the interim bill's Print page, its exact total, the place once (also the VAT bill); s.12(3)(c) on a function's invoice (FIN-18).
- FI-2 / D27-127 - Company accounts reads the City ledger report (`getReport`); `getCityLedger` removed.
- FD-16 / D27-117 - Check out asks first.

**Found:** FI-7 does not happen on a one-bill stay (issued, credited, Issue came back); it was the split-bill confusion. FIN-10 is settled by the same change. `roleGate.test.ts` (READ_RULES vs telemetry's system-health) fails on cp6 without this branch - the master's.

**Proved:** API on a fresh scratch DB at `149e6cf` - night audit, finance, front desk, admin's auditLog, businessDate, concurrency, laundry, spa: 210/210. Whole web suite 750/750 at `198c75c`; finance + front desk + guards 130/130 at `aeebfad`. Full gates: not run yet (the master's go).

**Left open:** FI-14 (credit notes' own series) waits for the CA (Q-2). The cosmetic rows (FI-17 to FI-19) after the pilot. `/reports/balances-by-source` on the server has no caller now - reports' to retire.

**Commits:** `3b1fb63`, `62c24a4`, `a8bd685`, `149e6cf`, `99a48f1`, `198c75c`, `1162baa`, `aeebfad`.

---

## 2026-09-28 · FIN-11: the drawer hand-over list (`cashier.ts`) lists the hotel's people (D27-97)

**Asked for:** the owner's D27-97, through the master: the same fault as housekeeping's HK-14. **Shipped:** the read uses `app.hotel_people` (migration 149), names only; branch `housekeeping/staff-lists-28sep`. **Proved:** `api/test/modules/finance/drawerColleagues.test.ts` failed on the old code (1 failed) and passed on the fix; `cd api && npx tsc --noEmit` exit 0. Full gates: the master's combined run.

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
