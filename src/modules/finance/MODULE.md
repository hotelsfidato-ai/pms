# Finance

The money: every bill and what is on it, payments, tax invoices and credit
notes, the desk's cash drawer, company accounts and the GST rules.

**Folder name:** `finance` — the same word in all three places:

```
src/modules/finance/          the screens, their data calls, their tests
api/src/modules/finance/      the server's routes for this service
db/tests/modules/finance.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

Finance keeps the ledger every other service writes into. At the desk the
receptionist sees a guest's **bill** (the Bill tab of the stay panel — this
service's `FolioPanel`): they post a charge, reverse a wrong one, split the
bill onto a company, and settle it before check-out. In Finance the same
thing is called a **folio**. The accountant sees every open folio, every
receipt, raises the GST tax invoice for a departed stay and corrects one only
with a credit note. The receptionist opens the cash drawer with a float,
takes receipts through the shift, counts it and hands it over. Company
accounts shows what each booking source owes. GST rules are set once for the
desk and the till.

## Screens

Who works from each is `workingMenus` in `nav.ts` (the owner's menu of
15 September). Roles without a working menu — owner, admin, GM, hotel
manager, accountant, viewer — see these in the full menu where their
permission allows; anyone whose permission allows can reach them with Find
a screen (Ctrl K).

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| Folios (Finance) | `/h/:code/folios` | `pages/Folios.tsx` | none |
| Invoices (Finance) | `/h/:code/invoices` | `pages/Invoices.tsx` | none |
| (no menu entry) one invoice or credit note | `/h/:code/invoices/doc/*` | `pages/Invoice.tsx` | — |
| (no menu entry) one VAT bill for alcohol, or its credit note (D22-44) | `/h/:code/invoices/vat/*` | `pages/VatBill.tsx` | — |
| (no menu entry) the interim bill, to print (QA FI-8) | `/h/:code/stays/:id/bill` | `pages/InterimBill.tsx` | — |
| Payments (Finance) | `/h/:code/payments` | `pages/Billing.tsx` (`PaymentsPage`) | none |
| Cashiering (Finance) | `/h/:code/cashiering` | `pages/Cashiering.tsx` | Reception |
| Cash deposits (Finance) | `/h/:code/cash-deposits` | `pages/CashDeposits.tsx` | none (owner, Admin, GM, accountant, Viewer; D27-191) |
| Company accounts (Finance) | `/h/:code/city-ledger` | `pages/Billing.tsx` (`PropertyCityLedgerPage`) + `flows/CompanyPayments.tsx` | none - Opening, Sent, Received, Balance (the City ledger report's); Record payment (desk or accounts) and Payments received with Reverse (D27-239, D27-242) |

Six addresses, five page files. Menu gates (`nav.ts`): Folios and Invoices
`invoice`; Payments and Cashiering `payment`; Company accounts `commission`.
An invoice number has slashes in it (`5EL/2026-27/00001`), so the one-invoice
address swallows the rest of the path (`routes.tsx`). The Finance section also
holds guests' Form C (order 60).

- `flows/FolioPanel.tsx` — the Bill tab inside front desk's stay panel:
  postings, charge, reverse, settle, split billing, and check out (which it
  asks front desk to do). For the owner, an administrator and the GM, a
  pencil on each charge (Edit: price or words, with a reason) and "Change
  rate" for the stay (D27-157, D27-162). Each line names who posted it ("Night audit" for
  the audit's room charge); its print, and the button that opens it, say
  "Interim bill", before check-out and after (D22-7, D24-25) - the numbered
  tax invoice is issued on Invoices. After a write that changes only the
  bill it asks again only what shows it - this stay's reads, the bell, the
  Rooms board, Folios - and gives In house and Due out this stay's balance;
  everything else is marked out of date (D27-316 (2), FIN-31). A change of
  rate and a check-out still refresh everything.
- `flows/CreditNoteFlow.tsx` — correct an issued invoice, from the invoice
  page; with `vat`, cancel a VAT bill the same way, from the VAT bill page.
- `flows/TaxRulesCard.tsx` — the GST (and VAT) rules card, shown on
  inventory's Room setup page and, since D23-1, on Invoices for the four
  who may set a rate (owner, admin, GM, accountant; the owner, 24
  September).

## Server endpoints

All hang from `/api/hotels`, in six files mounted by
`api/src/modules/finance/index.ts` in this order: `folios`, `postings`,
`cashier`, `billing`, `invoices`, `tax`. They arrived in the server split of
15 September: `folios.ts` moved whole (`3424882`); `postings.ts` and
`cashier.ts` were cut out of the old `operations.ts` (`b772047`); `billing.ts`
is what finance kept when the old `billing.ts` split four ways (`489271d`);
`invoices.ts` moved and handed Form C to guests (`1dcf9b7`); `tax.ts` came out
of the old `inventorySetup.ts` (`3ca215d`).

**`api/src/modules/finance/folios.ts`** (was `api/src/routes/folios.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/stays/:id/folio` | a stay's bill in one figure — what the stay panel and In house read. **The guest's own bills only** (the owner's D27-226): the nights a group's master carries for the stay are the company's and are not in it |
| GET | `/:code/folios` | every open folio (the Folios screen): a stay's own bills as one row, a group's master bill as one row named for the group (`groupId`, `group`; D27-226); a banquet function's bill is not listed |
| GET | `/:code/stays/:id/postings` | every line on a stay's bill, each with its `scheme`, `rate` and `source` (where it came from, through a correction to its origin - an early or late fee is the room's on the bill, D27-223) |
| GET | `/:code/stays/:id/bill` | the bill as it stands, `app.stay_bill` (123, 125, 166) - what the desk prints. Since D27-204 it adds `tonight` (`description`, `amount`, `tax`, `rate`) when a guest staying on has tonight's room night still to post: the night audit's own answer for this stay (`night-audit/roomNight.ts`). Absent when tonight is posted, the room is complimentary, there is no GST rule for rooms, or the guest leaves today. And `nightsToCome` (1 October, FIN-24): the nights still to come on this bill by the audit's own rule - none for a room billed to its group - which the Bill tab's box, its headline and the stay panel's foot read; the page counts no nights itself. The desk's bill only: `app.stay_bill`, which the guest's own page reads through its door, is unchanged (D27-205) |
| GET | `/:code/stays/:id/folios` | the stay's folios, when the bill is split |
| POST | `/:code/stays/:id/folios` | open another folio for the stay (split billing) |
| POST | `/:code/postings/:id/transfer` | move a line to another folio — two postings, never an edit |
| GET | `/:code/billing-companies` | companies a folio can be addressed to |

**`api/src/modules/finance/postings.ts`** (cut from the old `api/src/routes/operations.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/:code/stays/:id/charges` | post a charge; everything the desk posts carries the room rate of GST (`app.gst_rate`), unless the clerk marks it not taxable |
| POST | `/:code/stays/:id/charges/:postingId/reverse` | reverse a charge — once (021), with a required `reason` kept on the reversal line (D27-117); a payment only by the owner, an administrator, the GM or the accountant (D27-125); a charge or discount refused once a tax invoice stands on its bill (D27-162, FIN-19) |
| POST | `/:code/stays/:id/charges/:postingId/edit` | edit a charge's price and/or words with a `reason` (D27-157): the old line reversed and the corrected one posted in one step (`editFolioCharge`); owner, administrator, GM; refused on a closed day, with a tax invoice, for drinks with a VAT bill, and for a room night's words |
| POST | `/:code/stays/:id/rate` | change the stay's rate a night with a `reason` (D27-162): every charged night corrected to it (a closed day's through night-audit's `correctClosedCharge`), all or nothing; owner, administrator, GM. Before check-in it only changes the agreed rate, and with no night charged the reason goes into the booking's notes (D27-187, D27-195; the panel's menu opens `ChangeRateDialog`). `includesGst: true`: the rate is all-in and is split by `roomRateBeforeGst` first (D27-199) |
| GET | `/:code/tax/room/before-gst?gross=` | a room rate that includes GST, split as the booking keeps it (D27-195): `{ok, pre, rate, total}` - the slab on the pre-tax value, the nearest total not above the figure; the slab gap and no room rule refused in words (`roomRateBeforeGst`, also used by reservations' `book.ts`); anyone |
| POST | `/:code/stays/:id/payments` | take a payment: a posting and its receipt; one guest's (and group's) payments take turns (D27-2); more than the bill only with `heldAsCredit: true`, else refused with `needs: "credit"` (D27-4); `folioId` names the bill of a split stay (QA FI-2); cash opens the taker's own drawer by itself, after every refusal (`openOwnDrawer`, D27-200; every rupee still belongs to a shift, D27-118) |
| POST | `/:code/groups/:id/payments` | settle a group's open master bill (the owner's D27-305 (10)), the group's page's Settle: the same door (`takeFolioPayment`) in the group's turn; cash counted over the group's bills; "Bill to company" goes to the City ledger of the company the master is addressed to - refused when it is addressed to none - and over that company's credit limit (D27-279) only with `overLimitReason` from the owner, an administrator or the GM (`needs: "credit-limit"`; `Payer.check`, the door's last refusal). `payment` create |

**`api/src/modules/finance/cashier.ts`** (cut from the old `api/src/routes/operations.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/cashier-shift` | the drawer this person is holding (`app.cashier_expected_cash`), with `received` - the kept floats it took up and from whose close; with none open, `waiting` - the float handed to them by name (`app.cashier_float_waiting`) - and their last close's count, float kept and for whom (D27-202). A read opens nothing |
| POST | `/:code/cashier-shift/open` | open it BY HAND on a counted float - blank refused, 0 only when typed (D27-190, FIN-21). How a desk's first float gets in; every other drawer opens by itself (D27-200). What was handed to the person is taken up by it, never added on top |
| POST | `/:code/cashier-shift/movements` | money in or out of the drawer; opens the drawer by itself if none is open (D27-200). A paid-out (`expense`) is raised in the approvals inbox (kind `cash_expense`) and counts only once the GM or the owner says yes (D27-242); GET shows each one's decision and `waiting`, and the close asks a reason only beyond what waits |
| POST | `/:code/cashier-shift/count` | count it, by denomination |
| POST | `/:code/cashier-shift/close` | close and hand over, with `keptCash` - the float kept, always typed, 0 to counted; above 0 it needs `handOverTo`, the next person's name (D27-201, D27-202); the rest is to deposit. If that person's drawer is already open the float is added to its opening and taken up at once |

**`api/src/modules/finance/companyPayments.ts`** (2 October, D27-239, D27-242)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/company-payments` | what companies and booking sites paid (reversals beside their lines), the ledger's accounts for the picker, and the ways to pay. `invoice` view |
| POST | `/:code/company-payments` | record one against a company OR a booking site (the account the City ledger names): amount, received on (not after the business date), bank transfer / cheque / UPI / card (never cash, D27-242), reference, note. `payment` create - the desk or accounts |
| POST | `/:code/company-payments/:id/reverse` | a line of its own, once, with a reason. `payment` edit - the owner, an administrator, the GM, the accountant (D27-125) |
| GET | `/:code/payment-methods` · `/extra-charges` · `/discounts` · `/commission` | Settings › Money (191, the owner's D27-259): each list with On/Off, order and whether anything used a row; the default way of paying; the early/late fees; each source's and agent contract's commission. `setting` view |
| POST · PATCH `/:id` · DELETE `/:id` · PUT `/order` | `/:code/payment-methods`, `/extra-charges` (the inclusions list, 065), `/discounts` (room_promotions, % or ₹; no order) | change a list; delete only what nothing used. `room_config` edit - the owner, an administrator, the GM |
| POST | `/:code/payment-methods/:id/default` | the default way of paying (hotels.default_payment_method, which must name a method that is On) |

Its front door also exports `companyReceipts` (the day book's receipts, D27-242 Q4).

**`api/src/modules/finance/deposits.ts`** (30 September, D27-190, D27-191)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/cash-deposits` | each closed day's cash to deposit per cash point (`app.cash_to_deposit`), deposited, difference, red until explained; every deposit; `canRecord`, `canVerify`. Owner, Admin, GM, accountant, Viewer |
| POST | `/:code/cash-deposits` | record a deposit against the business day it banks: amount, date, bank, slip number. Owner, Admin, GM. The slip's photo goes through the shared `POST /attachments` (table `cash_deposits`) |
| POST | `/:code/cash-deposits/:id/reverse` | reverse an unverified deposit by a line of its own, with a reason, once. Owner, Admin, GM |
| POST | `/:code/cash-deposits/days/:date/explain` | why a day's deposits differ; red until then. Owner, Admin, GM |
| POST | `/:code/cash-deposits/:id/verify` | owner or accountant only; refused without the slip's photo or on a red day |

**`api/src/modules/finance/billing.ts`** (finance's part of the old `api/src/routes/billing.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/payments` | every receipt, newest first; reversed ones stay on the list; "Taken by" is who took it (`app.posted_by_name`), a dash for nobody |
| GET | `/:code/billable` | departed stays ready to invoice, with the number already issued against any |

**`api/src/modules/finance/invoices.ts`** (was `api/src/routes/invoices.ts`, less Form C)

| Method | Path | What it does |
|---|---|---|
| POST | `/:code/stays/:id/invoice` | issue the tax invoice for one BILL of a stay (`folioId`; a split stay without one is refused - QA FI-1) (`app.next_invoice_number`) — and, in the same transaction, the VAT bill for its alcohol (`app.issue_vat_bill`, D22-44) |
| POST | `/:code/groups/:id/invoice` | the tax invoice for a group's open master bill (D27-305 (10)), through `issueFolioInvoice`: to the company the master is addressed to, else the guest who leads the group (`app.group_lead`), else the group's name. Never sent by itself (D27-284): `app.guest_invoices_owed` reads a stay's bills only. `invoice` create |
| GET | `/:code/invoices/:number{.+}` | one invoice or credit note, with the lines it was made from; `masterBill` true on a group's master bill's, where the Invoice page offers no Send invoice - nothing sends it (D27-307 (4)) |
| GET | `/:code/invoices` | every number issued here |
| GET | `/:code/invoice-series` | the series itself |
| POST | `/:code/invoices/:number{.+}/credit-note` | correct an invoice with a credit note of its own number |
| GET | `/:code/vat-bills` | every VAT bill issued here (D22-44) |
| GET | `/:code/vat-bills/:number{.+}` | one VAT bill, naming the tax invoice or restaurant bill it was issued with |
| POST | `/:code/vat-bills/:number{.+}/cancel` | cancel a VAT bill with a credit note from the VAT series, with a reason (owner, admin, GM, accountant) |

**`api/src/modules/finance/tax.ts`** (cut from the old `api/src/routes/inventorySetup.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/tax` | the GST rules, and `servesAlcohol`; the `alcohol` kind is listed only where the property is switched on for it (D21-90) |
| PUT | `/:code/tax/:kind` | set the rules for one kind — room, restaurant, bar, banquet, spa, alcohol or other (067, 119, 126). `alcohol` is VAT: one rate, no bands, refused while the property is not switched on for alcohol |
| PATCH | `/:code/menu-categories/:name/tax-kind` | say which kind a menu category is taxed as; `alcohol` refused while the switch is off |
| GET | `/:code/tax/:kind/rate?amount=` | the rate one charge of that kind and value would carry (`app.gst_rate_or_null`), or null — the Add charge dialog's preview (22 September) |

29 endpoints. The old `billing.ts`'s other endpoints went to inventory
(`rateGrid.ts`), the night audit (`checklist.ts`) and the core
(`api/src/routes/notifications.ts`). Server tests:
`api/test/modules/finance/invoices.test.ts` (it also holds the Form C tests,
though Form C is now guests'); `api/test/concurrency.test.ts` ("a posting can
be reversed once") is still in `api/test/`.

## Data

`src/modules/finance/data/`:

| File | What it does |
|---|---|
| `postings.ts` | a stay's lines and balance (`getFolioPostings`, `getFolioBalance`), post a charge, reverse one, settle; asks `src/lib/rules.ts` (`canPostCharge`, `canReverse`) first |
| `../sections.ts` | THE BILL IN SECTIONS (D27-200): `sectionOf` (a line's section by its category and tax scheme) and `billSections` (each section's lines, subtotal and tax rows). The Bill tab and `BillPrint` both read it; `useStayDue` (FolioPanel) is the one due figure for the headline, the closing row and the stay panel's foot |
| `folios.ts` | one stay's folio (`getFolio`), the open folios (`listOpenFolios`: of every booking, or of the stays a screen passes, D27-316), split billing (`listStayFolios`, `openFolio`, `transferPosting`, `listBillingCompanies`) |
| `billing.ts` | payments and payments by method, billable stays, the invoice series, invoices, issuing one, a credit note |
| `cashier.ts` | the drawer: read, open, money in or out, count, close |
| `tax.ts` | the GST (and alcohol's VAT) rules: read, set for a kind, a menu category's kind, and the rate one charge would carry (`getTaxRate`, the Add charge preview) |

## Database

Tables this service owns — the ledger the others write into — and the
migrations that made or changed them:

| Table | What it holds | Migrations |
|---|---|---|
| `folios` | one running account; several per stay when the bill is split, or a group's master | created `006_folio.sql`; `056_group_billing.sql` (a group's master; a folio belongs to exactly one thing), `060_banquet.sql` (a function's folio) |
| `folio_postings` | every charge, reversal and payment line | created `006_folio.sql` (money is `numeric(12,2)`; append-only; `business_date` is a real column); `011_model_additions.sql` (`idempotency_key`), `012_integrity.sql` (no posting onto a closed day), `014_simulation_fixes.sql` (UPDATE and DELETE revoked; same-hotel keys), `015_edge_cases.sql` (the tax must match the one rate on the line; no zero lines), `021_reversal_once.sql` (a line is reversed at most once), `056_group_billing.sql` (`reservation_id`, filled by a trigger) |
| `payments` | the receipt behind a payment line | created `011_model_additions.sql`; `014_simulation_fixes.sql` (same hotel as its posting), `016_audit_coverage.sql` (never zero; audited) |
| `vat_bills`, `vat_bill_series` | VAT bills for alcohol and their credit notes (D22-44): their own series per hotel, `VAT/5EL/2026-27/0001`, opened by the year's first bill so it restarts each 1 April | "a separate VAT bill for alcohol" (135 in this branch: `app.next_vat_bill_number`, `app.issue_vat_bill`; 025's immutability trigger) |
| `invoices`, `invoice_series` | tax invoices and credit notes, numbered from a statutory series | created `011_model_additions.sql` (`app.next_invoice_number`); `013_policies.sql` (numbering protected), `014_simulation_fixes.sql` (the first invoice at a property), `016_audit_coverage.sql` (a series only moves forward), `025_invoices_form_c.sql` (the GST fields, credit notes, never edited, a series opened for each new property); "the FSSAI number on the invoice" (145 in this branch: `fssai_number`, copied from the hotel at issue and printed from there, D27-3) |
| `cashier_shifts`, `cashier_movements`, `cashier_denominations` | the desk's drawer | created `059_cashier_shift.sql` (`app.cashier_expected_cash`; a closed shift is final); "the cash deposits log" (163: `kept_cash`, the float kept at the close) |
| `company_payments` | what a company or booking site paid against the City ledger (D27-239): append-only (insert/read; a reversal is its own line, once); bank, cheque, UPI or card | "company payments and cash expenses" (189). The same migration seeds every hotel's `cash_expense` approval rule (the GM, also the owner, every amount, a trigger for new hotels) and `app.cash_expense_counts`, which both drawers' expected-cash functions now ask |
| `payment_methods` | each hotel's ways of paying (191): the word on the bill, what it is in the books (payments' 8 kinds), On/Off, order. Seeded with the five the screens offered, for new hotels too; triggers keep the default On and carry it through a rename. The payment door (`takeFolioPayment`) takes only one that is On and keeps the word in `payments.method_label` | "money settings" (191), with `inclusions.is_transport` (a pickup or drop), `room_promotions.amount` and `reservations.discount_amount` (₹ off each night) |
| `cashier_float_claims` | which drawer took up the float a close kept (D27-200): the primary key is the close, so a float is carried into one drawer, once | "cash opens by itself" (165: `app.cashier_float_waiting`; also `app.pos_opening_cash` for the till, and `app.pos_expected_cash` reading it). **A close that kept a float with nobody named - made before D27-201 - is never carried: it stays unclaimed** |
| `cash_deposits`, `cash_deposit_notes` | cash banked per business day, and why a day's deposits differ (D27-190) | "the cash deposits log" (163: append-only - insert and read, the verification stamp once; `app.cash_to_deposit`, also over `pos_day_ends.kept_cash`) |
| `tax_rules` | GST as rules, one set for the desk and the till — and VAT on alcohol (kind `alcohol`) | created `067_tax_rules.sql` (`app.gst_rate`; the tax kind on outlets and menu categories); `119_the_spa.sql` (`spa`); "alcohol, a switch per property, and the VAT it is taxed under" (126 in this branch: `alcohol` as a kind and a menu heading, `folio_postings.tax_scheme` and `pos_order_lines.tax_scheme` gst/vat, a reversal takes its original's scheme, `app.pos_order_by_tax`, `app.stay_bill`'s `vat` rows) |

Others post into it directly in SQL: front desk (a folio at check-in and
walk-in, early and late charges, the walk-in's first night, the folio closed
at check-out), reservations (a folio for every booking, a group's master),
the night audit (every night's room charge, retention charges) and the
restaurant (`pos.ts` and `till.ts` — charges to a room). Reports read it:
`/reports/guest-ledger`, `/reports/cashier-shift`, `/reports/gst-sales`,
`/reports/city-ledger` (the last is what Company accounts shows).

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts`.

## Front door

What `index.ts` exports, and who uses each (grep of `@/modules/finance`,
15 September):

| Export | Used by |
|---|---|
| `getFolio` | front desk (`flows/StayDrawer.tsx`); the core test `repositories.test.ts` |
| `SettleDialog`, `IssueInvoiceDialog`, `settleGroupBill`, `issueGroupInvoice` | reservations (`pages/GroupPanel.tsx`): the host's account is settled and invoiced with the Bill tab's own Settle and Invoices' own "are you sure" (D27-305 (10)) |
| `listOpenFolios` | front desk (`data/stayview.ts`, with the window's stays); the core test |
| `getFolioBalance` | front desk (`data/operations.ts`, `pages/InHouse.tsx`) |
| `FolioPanel` | front desk (`flows/StayDrawer.tsx`) — the Bill tab |
| `TaxRulesCard` | inventory (`pages/RoomSetup.tsx`) |

On the server (`api/src/modules/finance/index.ts`): `postCharge` (laundry, spa), and since 28 September the per-bill door for a banquet function's bill - `takeFolioPayment`, `postFolioCharge`, `issueFolioInvoice`, `folioBalance` (round E). `editFolioCharge` since 30 September (D27-205): the front desk's room move puts tonight's posted night right to a new rate through it.

## Leans on

Other services, through their doors only:

- **front desk** — `fetchStays` (`data/folios.ts`), `getStay` and type
  `Posting` (`data/postings.ts`), `checkOut`,
  `earlyArrival` and `LateCheckOutFlow` (`flows/FolioPanel.tsx`), `StayTable`
  (`pages/Folios.tsx`).
- **reports** — `getReport` (`pages/Billing.tsx`): Company accounts shows the
  City ledger report's own figures (D27-127, 28 September).

And the core: `src/lib/rules.ts` (charge categories, payment methods,
`taxOn`, `splitTax`, `roundOff`, `canPostCharge`, `canReverse`), the shared
types, `BUSINESS_DATE` and `PTD_FROM`.

## Rules that bind it

- **Bill at the desk, Folio in Finance** (owner, 15 September, `HANDOVER.md`
  § 4). `FolioPanel` is drawn at the desk, so its words are the desk's: its
  balance label and the settle and check-out reasons say "bill" (CHANGELOG
  15 September, step 2; MEMORY 265). The Finance screens keep "folio".
- **The legal name on a bill is Fidato's, chosen in settings; bank details
  are per hotel** (owner, 14 September, `HANDOVER.md` § 4). Documents on the
  voucher template are **ask first** (`HANDOVER.md` § 3.5).
- **Payment gateway: excluded for now** (owner, 8 September; CHANGELOG
  2026-09-08 (phase 1); PENDING § 3).
- **E-invoicing (IRN) is not required — the group is under ₹5 crore**
  (`PROGRESS.md`, "What the owner has decided"; undated there).
- **No default prices; a null is a dash, never a zero; money in tabular
  numerals** (`HANDOVER.md` § 5 and § 6). **Never show a figure the database
  has not agreed to** (§ 5).
- **The ledger is append-only.** A wrong charge is reversed, once, and the
  reversal is its own line (`006_folio.sql`, 014, 021; MEMORY 15, 24; the
  Folios screen says so).
- **The date on money is the business date, never the clock** — a receipt
  at 00:40 belongs to the day the hotel is still in (006's rule 3; MEMORY 19).
- **One posting carries one tax rate** (015; MEMORY 55), and **GST is one
  set of rules for the desk and the till** (067).
- **Alcohol is VAT, not GST, and only where the property serves it** (owner,
  D21-90 and D21-91, 21 September). The "serves alcohol" module switch is off
  by default and is the owner's and an administrator's. The VAT rate is never
  seeded — the tax card shows a dash until somebody types it (the accountant
  confirms it). A dish in a section taxed as alcohol that follows the
  section's rate is rung as VAT; a dish with its own rate is the section's GST
  exception. VAT prints as ONE line per rate on the stay's bill and the
  restaurant's bill, never as CGST/SGST; it is left off the GST invoice (so
  off the GST sales register) and has its own Alcohol and VAT columns in the
  accountant's day book, whose GST columns carry none of it. **It has its own
  VAT bill (D22-44)**, issued in the same transaction as the stay's tax
  invoice or the restaurant's settlement (cash, card, UPI or split - not a
  function's bill), from its own series; the tax invoice (and the restaurant
  bill) names it and it names them.
- **An invoice states what was charged and never recomputes tax; the place of
  supply is the hotel, so CGST + SGST, never IGST; an issued invoice is never
  edited — it is corrected by a credit note** (`invoices.ts` header; 025;
  MEMORY 31, 33, 38).
- **`money()` for a dashboard, `moneyPrecise()` for anything a person is
  handed** (MEMORY 57).
- **The bill's main action follows its state** — Settle while money is owed,
  Check out once it may happen, never both (clarity step 2, `HANDOVER.md`
  § 3.1; "shows one main action on each tab of the stay panel", in front
  desk's `src/modules/front-desk/front-desk.test.tsx`).
  Any new dialog must pass `src/components/ui/primaryAction.test.ts`.
- **Start here, reception's card** (`src/components/app/startHereCards.ts`)
  names this service's buttons: "Take a payment — Open the guest, go to Bill,
  **Settle**, then **Take payment**"; "Check a guest out — … **Check out**
  opens once nothing is owed"; "Count and close the cash drawer - Your
  drawer opens by itself with your first cash. At hand over, count it, type
  the float kept and who takes it." (D27-200; the master's, 30 September)
  Rename one and the card changes too (`HANDOVER.md` § 3.3).
- **Glossary:** the Folios screen uses the `folio` line of
  `src/lib/glossary.ts`; if what a folio is changes, the line changes.
- **A shorter menu keeps everything reachable by search** (owner,
  15 September). Reception's working menu carries Cashiering from here; the
  other finance screens are search-only for reception (`HANDOVER.md` § 3.2).
- **With the line down** (`src/lib/offline.ts`, core; guarded by
  `src/lib/offline.test.ts`): invoices, payments, the cashier shift, charges,
  reversals, transfers and opening a folio are all refused — the tax rules
  are not named there, so they are refused too. A change to that table is a
  request to the core owner.
- **A refusal goes above the first write** (MEMORY 243).
- **Never deploy during the night audit** (`HANDOVER.md` § 9); production
  deploys are the owner's (`HANDOVER.md` § 5).

## Open items

From `PENDING.md` and `HANDOVER.md`, and two found while writing this brief:

- **Documents on the voucher template — ask first** (`HANDOVER.md` § 3.5).
  The CRS voucher `FH-2026-00002` is not in the repo; the owner must save it
  into `D:\reports fidato\` first. Still needed from the owner: Fidato's
  registered name as it prints, the GSTIN for bills, bank details per hotel,
  policies and times, and how WhatsApp and email should send.
- ~~`const USER = "front desk"` in `flows/FolioPanel.tsx`~~ — fixed 24
  September (FIN-6): gone, and a bill line names the person who posted it.
- **"Which room was this stay in" written by hand** in two of the seven
  copies — `GET /:code/payments` and `GET /:code/billable`
  (`api/src/modules/finance/billing.ts`); `app.stay_room()` (086) is the one
  rule; moving onto it is tidying (PENDING § 6).
- ~~Defect 243's shape in these routes has not been checked~~ — checked 23
  and 24 September: one found and fixed, `postCharge` (FIN-7).
- ~~FIN-8: the GST series for a new financial year exists only after a
  deploy~~ — fixed 24 September (D24-22): the year's series opens itself
  with its first invoice.
- **FIN-1, found while writing this brief:** the header of
  `api/src/modules/finance/billing.ts` still says "NO INVOICE NUMBER IS
  ISSUED" and "THE NIGHT AUDIT DOES NOT RUN"; both have been built. A
  comment, not a screen; not fixed. See `DEFECTS.md` here.
- **Noticed, not investigated:** `getFolioBalance` returns `0` when a stay
  has no folio (`data/postings.ts`, `folio?.balance ?? 0`). Front desk's
  In house and check-out read it. Whether any screen then shows or acts on
  that zero has not been checked — look before relying on it (the rule:
  a missing figure is a dash; MEMORY 106).

## Gates

Before the first edit: claim this service in `HANDOVER.md` → Folder claims
(service, branch, date), and work in your own worktree with your own
database and ports — how, in `AGENTS.md` ("Before your first write"); the
rules for parallel agents, in `docs/SERVICE-FOLDERS-PLAN.md`.

```
# the PC, in your worktree's folder (PowerShell or Git Bash)
npx tsc -b                      # web types — no output at all
npx vitest run                  # web tests
cd api && npx tsc --noEmit      # server types
cd api && npm test              # server tests — never `npx vitest run` inside api/ (MEMORY 196, 221, 264)

# the PC, Git Bash, in your worktree's folder — needs the local Postgres (HANDOVER.md § 7)
db/tests/run.sh                 # every database check, on a scratch database
db/tests/rerun.sh               # only if you added a migration: it must run twice
```

⚠ A fresh worktree has no copy of the main folder's untracked `.env`;
`AGENTS.md` ("Before your first write") gives your copy a `.env.local` with
`VITE_API_URL` and `VITE_ALLOW_DEV_AUTH=1`. Measured at `c804aa2` in the
worktree this brief was written in: with no env file, `npx vitest run` failed
31 of 204 (19 in `src/App.test.tsx`, 10 in front desk's, 2 in reports');
with only `VITE_ALLOW_DEV_AUTH=1` it still exited 1; with that and
`VITE_DEMO_MODE=1`, 4 of 204 failed, all in `src/App.test.tsx` (not
investigated). A gate's answer is its exit code (MEMORY 274). Never print an
env file.

The guards this service must respect:

- `src/test/boundaries.test.ts` — another service is reached only through its
  `index.ts`; every service folder keeps its `index.ts` and `MODULE.md`.
- `src/test/migrationNumbers.test.ts` — one number, one migration.
- `src/components/app/navigation.test.ts` — pins Reception's working menu.
- `src/components/ui/primaryAction.test.ts` — every dialog declares its main
  action.
- `src/data/repositories/repositories.test.ts` — no exported data function
  without a caller.
- `src/lib/offline.test.ts` — which writes may be held offline.
- `src/modules/front-desk/front-desk.test.tsx` — front desk's test, which
  drives this service's Bill tab (one main action per tab of the stay panel).

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the finance agent does it.

## The bill's sections and the reports (D27-223, 1 October)

The Bill tab and the printed bill put the desk's early check-in and late
check-out fees under Room, by their source (`early_checkin`, `late_checkout`;
`sections.ts`). The REPORTS DO NOT MOVE: these fees stay category `misc`, so
they are not Room Charges and not in ADR; the Manager report keeps its own
early check-in and late check-out lines as before (`builders/manager.ts`).
That is the owner's call through the master (the bill's sections only);
changing it is a separate decision.
