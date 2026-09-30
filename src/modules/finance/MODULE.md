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
| Company accounts (Finance) | `/h/:code/city-ledger` | `pages/Billing.tsx` (`PropertyCityLedgerPage`) | none |

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
  tax invoice is issued on Invoices.
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
| GET | `/:code/stays/:id/folio` | a stay's bill in one figure — what the stay panel and In house read |
| GET | `/:code/folios` | every open folio (the Folios screen) |
| GET | `/:code/stays/:id/postings` | every line on a stay's bill |
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
| POST | `/:code/stays/:id/rate` | change the stay's rate a night with a `reason` (D27-162): every charged night corrected to it (a closed day's through night-audit's `correctClosedCharge`), all or nothing; owner, administrator, GM. Before check-in it only changes the agreed rate, and with no night charged the reason goes into the booking's notes (D27-187, D27-195; the panel's menu opens `ChangeRateDialog`) |
| GET | `/:code/tax/room/before-gst?gross=` | a room rate that includes GST, split as the booking keeps it (D27-195): `{ok, pre, rate, total}` - the slab on the pre-tax value, the nearest total not above the figure; the slab gap and no room rule refused in words (`roomRateBeforeGst`, also used by reservations' `book.ts`); anyone |
| POST | `/:code/stays/:id/payments` | take a payment: a posting and its receipt; one guest's (and group's) payments take turns (D27-2); more than the bill only with `heldAsCredit: true`, else refused with `needs: "credit"` (D27-4); `folioId` names the bill of a split stay (QA FI-2); cash only by someone holding an open drawer (D27-118) |

**`api/src/modules/finance/cashier.ts`** (cut from the old `api/src/routes/operations.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/cashier-shift` | the drawer this person is holding (`app.cashier_expected_cash`) |
| POST | `/:code/cashier-shift/open` | open it with a float |
| POST | `/:code/cashier-shift/movements` | money in or out of the drawer |
| POST | `/:code/cashier-shift/count` | count it, by denomination |
| POST | `/:code/cashier-shift/close` | close and hand over |

**`api/src/modules/finance/billing.ts`** (finance's part of the old `api/src/routes/billing.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/payments` | every receipt, newest first; reversed ones stay on the list; "Taken by" is who took it (`app.posted_by_name`), a dash for nobody |
| GET | `/:code/billable` | departed stays ready to invoice, with the number already issued against any |

**`api/src/modules/finance/invoices.ts`** (was `api/src/routes/invoices.ts`, less Form C)

| Method | Path | What it does |
|---|---|---|
| POST | `/:code/stays/:id/invoice` | issue the tax invoice for one BILL of a stay (`folioId`; a split stay without one is refused - QA FI-1) (`app.next_invoice_number`) — and, in the same transaction, the VAT bill for its alcohol (`app.issue_vat_bill`, D22-44) |
| GET | `/:code/invoices/:number{.+}` | one invoice or credit note, with the lines it was made from |
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
| `folios.ts` | one stay's folio (`getFolio`), the open folios (`listOpenFolios`), split billing (`listStayFolios`, `openFolio`, `transferPosting`, `listBillingCompanies`) |
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
| `cashier_shifts`, `cashier_movements`, `cashier_denominations` | the desk's drawer | created `059_cashier_shift.sql` (`app.cashier_expected_cash`; a closed shift is final) |
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
| `listOpenFolios` | front desk (`data/stayview.ts`); the core test |
| `getFolioBalance` | front desk (`data/operations.ts`, `pages/InHouse.tsx`) |
| `FolioPanel` | front desk (`flows/StayDrawer.tsx`) — the Bill tab |
| `TaxRulesCard` | inventory (`pages/RoomSetup.tsx`) |

On the server (`api/src/modules/finance/index.ts`): `postCharge` (laundry, spa), and since 28 September the per-bill door for a banquet function's bill - `takeFolioPayment`, `postFolioCharge`, `issueFolioInvoice`, `folioBalance` (round E).

## Leans on

Other services, through their doors only:

- **front desk** — `fetchStays` (`data/folios.ts`), `getStay` and type
  `Posting` (`data/postings.ts`), `checkOut`, `checkOutAllowed`,
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
  opens once nothing is owed"; "Open the cash drawer — Enter the opening
  float, then **Open the drawer**. **Close the shift** when you hand over."
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
