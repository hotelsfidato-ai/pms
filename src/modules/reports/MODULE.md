# Reports

The numbers the owner and the managers read: the Dashboard, the Manager
report, the statistics, the ledgers, and the statutory registers. Read only —
this service writes nothing.

**Folder name:** `reports` — the same word in all three places:

```
src/modules/reports/          the screens, their data calls, their tests
api/src/modules/reports/      the server's routes for this service
db/tests/modules/reports.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service in `.claims/reports.md` (branch,
copy, what you are doing — `.claims/README.md`), read `docs/briefs/reports.md`,
this file, then this folder's `DEFECTS.md` and `CHANGELOG.md`. Written 15
September 2026 from the code at `880a5b6`; brought up to date 16 September.

---

## What it is

The **Dashboard** is the first screen for most people: tiles for the chosen
hotel — occupancy, rates, revenue, who is arriving — and a table of all
hotels below. **All reports** is the index. The **Manager report** gives
today, the month so far and the year so far in three columns, the way the
owner's old eZee export printed it. The rest are the day-to-day and statutory
reports an accountant or a manager opens: monthly and yearly statistics, the
city ledger, no-shows, the guest ledger, a cashier's shift, lodging tax, the
GST sales register and the Form C (foreign guests) register. They print, and
most export CSV.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Dashboard | `/` | `pages/Dashboard.tsx` | Reception |
| All reports | `/reports` | `pages/Index.tsx` | none |
| Manager report | `/reports/manager` | `pages/ManagerReport.tsx` | none |
| Night audit report | `/reports/night-audit` | `pages/NightAudit.tsx` | search only |
| City ledger | `/reports/city-ledger` | `pages/Ledgers.tsx` (`CityLedgerPage`) | search only |
| No show | `/reports/no-show` | `pages/Ledgers.tsx` (`NoShowPage`) | search only |
| Lodging tax | `/reports/lodging-tax` | `pages/Ledgers.tsx` (`LodgingTaxPage`) | search only |
| Monthly occupancy | `/reports/monthly-occupancy` | `pages/Statistics.tsx` | search only |
| Monthly statistics | `/reports/monthly-stats` | `pages/Statistics.tsx` | search only |
| Yearly statistics | `/reports/yearly-stats` | `pages/Statistics.tsx` | search only |
| GST sales register | `/reports/gst-sales` | `pages/Compliance.tsx` | search only |
| Form F / C-Form | `/reports/c-form` | `pages/Compliance.tsx` | search only |
| Guest ledger | `/reports/guest-ledger` | `pages/Compliance.tsx` | search only |
| Cashier shift | `/reports/cashier-shift` | `pages/Compliance.tsx` | search only |
| Closing stock | `/reports/stock-on-hand` | `pages/Store.tsx` | search only |
| Stock movement by day | `/reports/stock-movements` | `pages/Store.tsx` | search only |
| Consumption | `/reports/stock-consumption` | `pages/Store.tsx` | search only |
| Wastage and breakage | `/reports/stock-wastage` | `pages/Store.tsx` | search only |
| Count differences | `/reports/stock-count-differences` | `pages/Store.tsx` | search only |
| Dead stock | `/reports/stock-dead` | `pages/Store.tsx` | search only |
| Days of cover | `/reports/stock-cover` | `pages/Store.tsx` | search only |
| Supplier spend | `/reports/supplier-spend` | `pages/Store.tsx` | search only |
| Equipment report | `/reports/equipment` | `pages/Store.tsx` | search only |

**The Store and equipment reports (phase 3A; D27-238, D27-240)** are built in
`api/src/modules/reports/builders/stock.ts` and `equipment.ts`, from the
Store's ledger and the equipment register. Read by the owner, admin, GM, hotel
manager, Inventory Manager, accountant and Viewer (roleGate `STORE_REPORTS`;
the menu's `mayReadStockReports`, exported with `STOCK_REPORT_LINKS` for the
Store's Reports menu, which the master points at them at merge); downloaded by those holding the Store's export
(reportFiles `STORE_EXPORTERS`). Every value is its moment's, from the Store's
one running average, `app.stock_movement_costs` (migration 180): a delivery at
what was paid, everything else at the average then; prices before GST, a
missing one a dash. Till sales and the food cost (before GST, D27-242) show
only to a reader holding `report`, as on the Store. A department not given is
"(not said)". Count differences read `stock_count_lines`, not the
adjustments.

- **The eight in the owner's layout** (D17-62) are Night audit, Manager, City
  ledger, No show, Monthly occupancy, Monthly statistics, Yearly statistics and
  Lodging tax. Each is one `ReportDoc` from the server, drawn by
  `components/ReportView.tsx` inside `components/DocumentReport.tsx`. The four
  Compliance screens still draw their own tables.
- **The printed Night audit is a report, not the audit.** The night-audit
  service owns the screen that RUNS the audit; this one reads the day (the
  owner, 17 September).
- "Search only" is `listed: false` in `nav.ts`: in nobody's sidebar, always
  reachable by Find a screen (Ctrl K) for a role that may open it.
- The Dashboard needs the `dashboard` grant; every report the `report` grant.
- These routes carry no `/h/:code/` prefix and no `PropertyScope`; the pages
  read the hotel in view from the session (`useUi`).

## Server endpoints

`api/src/modules/reports/`; the door `index.ts` mounts them at `/api/hotels`.
Every one is a GET.

**The eight reports, each one document** — `documents.ts`, one explicit route per
key so the master's `<key>.pdf`, `.xlsx` and `.csv` routes are never answered
here by mistake:

```
GET /:code/reports/manager            ?asOn=
GET /:code/reports/night-audit        ?asOn=
GET /:code/reports/city-ledger        ?asOn= &from= &ignoreZero=
GET /:code/reports/no-show            ?asOn=
GET /:code/reports/monthly-statistics ?month=YYYY-MM
GET /:code/reports/monthly-occupancy  ?month=YYYY-MM
GET /:code/reports/yearly-statistics  ?year=YYYY
GET /:code/reports/lodging-tax        ?month=YYYY-MM
```

A malformed parameter is refused with a sentence (400), never guessed at. With
nothing sent, every report is as on the property's own business date.

**The rest**

```
GET /:code/statistics/daily      no screen (KNOWN_UNREACHABLE)
GET /:code/statistics/period     the Dashboard; the property page (admin); All
                                 properties. adr and revpar come back exact
                                 (not rounded to the paisa): a screen rounds
                                 once, when it prints (D27-308 (1c))
GET /:code/statistics/snapshot   the property page (admin)
GET /:code/reports/guest-ledger · /cashier-shift · /gst-sales · /c-form
GET /:code/reports/balances-by-source   finance's "Company accounts" screen
```

**`buildReport(client, hotelId, key, params)`** is the one door to a report's
figures, exported from `index.ts` with the `ReportDoc` types. The screens reach
it through the routes above; the master's PDF, .xlsx and CSV routes call it
directly under the caller's own session (the contract of 17 September). It
THROWS on a key it does not know — an empty document would print as a real
report with nothing in it.

**Dates on the server, one rule each.** `asOn` defaults to the business date;
PTD starts on the first of `asOn`'s month; YTD starts on `financialYearStart(asOn)`
in `builders/manager.ts` — 1 April on or before it, the same April rule as
`app.current_fin_year()`, which reads the wall clock and so cannot answer for
another day. No report date is a literal (REP-1, REP-2, REP-4).

## Data

**On the server** (`api/src/modules/reports/`):

```
document.ts   the contract: ReportDoc, sections, columns, rows, facts, chart.
              Raw values - money in rupees, percent 0 to 100, dates YYYY-MM-DD,
              null for a figure this system does not hold. The web keeps a copy
              in data/document.ts; change both, or neither.
figures.ts    ONE derivation for every report. NIGHTS is the shared SQL:
              a posting saying "· N nights" split evenly over those nights (the
              paise to the last), a night not posted yet from the business date
              on at the booking's rate (the owner, D17-71). dailyFigures() adds
              them up by date; its `sold` is the one "rooms sold": paying, plus
              complimentary and half of each day use as the hotel's two
              switches say (Settings, Front desk rules; soldRule(), migration
              192). The Manager report, the Rates calendar, Monthly occupancy,
              Monthly statistics and Yearly statistics divide by it (D27-307);
              the three statistics reports' first footnote says how the
              switches stand. stayNights() reads the nights room by room;
              propertyFor() heads every report from the database, never a
              literal.
build.ts      buildReport(), BUILT_KEYS, and what each key is built from.
builders/     manager.ts · nightAudit.ts · statistics.ts · cityLedger.ts ·
              noShow.ts · lodgingTax.ts
reports.ts    the four Compliance reports and balances-by-source.
statistics.ts period, snapshot and daily, for the Dashboard and admin.
```

**On the web** (`src/modules/reports/`):

```
data/document.ts        the types, and getReport(hotelId, key, query)
data/reportData.ts      getGuestLedger, getCashierShift, getGstSales, getCForm,
                        getCityLedger (balances by booking source, finance's)
data/statistics.ts      listDailyStatistics, getPeriodStatistics,
                        getTodaySnapshot; monthOf(date) - the month the monthly
                        and yearly pages report, from the business date (REP-1).
                        getPeriodStatistics and getTodaySnapshot send no date
                        unless given one: the route then answers on THAT
                        property's business date and month (D27-308 (1a))
components/ReportView.tsx      draws any ReportDoc: bands, spanning headings,
                        totals ruled off, negatives in red, "-" for a figure not
                        held, and the bar chart. Dates print 25/08/2026 (D17-77).
components/DocumentReport.tsx  one report screen: load, then draw. Four states,
                        and the PDF / Excel / CSV buttons (the master's
                        downloadFile), disabled until the report has loaded.
components/ReportShell.tsx     the chrome: the property and the person from the
                        session, print styling, the "Printed" stamp, and Amount,
                        which prints "-" for null, never a zero.
```

## Database

This service owns no tables and writes nothing. It reads `folio_postings`,
`folios`, `reservations`, `room_assignments`, `rooms`, `room_types`,
`guests`, `guest_documents`, `form_c_filings`, `companies`,
`booking_sources`, `invoices`, `payments`, `staff` and `hotels`, and calls:

```
app.sellable_rooms       022_room_blocks.sql, redefined in 044_restrictions.sql —
                         the denominator of every occupancy figure
app.booking_source_label 082_booking_sources.sql — where a booking came from, NULL
                         (a dash) when nothing is known
app.form_c_due           025_invoices_form_c.sql
```

A column added to any of those tables can break a report query here — grep
the joins for its name first (MEMORY 102).

**A new migration needs a number claimed in `HANDOVER.md` first.**
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. The highest today is 089.

---

## Front door

`src/modules/reports/index.ts` exports:

```
getCityLedger, CityLedgerRow          → src/modules/finance/pages/Billing.tsx
getPeriodStatistics, getTodaySnapshot → src/modules/admin/pages/Property.tsx
listDailyStatistics, getPeriodStatistics, getTodaySnapshot
                                      → src/data/repositories/repositories.test.ts (a test)
```

The server's door, `api/src/modules/reports/index.ts`, exports only `mounts`
(`statistics`, `reports`, `manager`), read by `api/src/server.ts`.

---

## Leans on

- **front desk** — `getStayView`, `fetchStays` and type `ChartRoom`
  through `@/modules/front-desk`, on the Dashboard: the board of its day and
  that day's bookings for today's work (`fetchStays(code, date, date, true)`,
  the board's read, D27-316 (1)) - never every booking.
- Everything else, read only, at the database: the tables listed above belong
  to finance, the front desk, reservations, guests and inventory.
- The core: `listProperties` and the business date (`@/data/repositories`),
  the glossary, CSV, and Start here.

---

## Rules that bind it

- **Never show a figure the database hasn't agreed to; a null is a dash**
  (`HANDOVER.md` § 5 and § 6 — `Amount` in `ReportShell` does it). A
  placeholder that looks like data is data to whoever reads it, words
  included (MEMORY 266). A date on a screen is a number like any other:
  derived, or a dash (MEMORY 147, 253).
- **The owner's decisions:** "Group" is called Dashboard — tiles for the
  chosen hotel, a table of all hotels below (14 Sep); the Dashboard is one of
  the three first screens a GM can set per person (14 Sep); report names keep
  their words, in sentence case (15 Sep); a shorter menu keeps everything
  reachable by search — Reports lists only Night audit, All reports and
  Manager report (15 Sep) (`HANDOVER.md` § 4, § 3.2). No Dashboard for
  housekeeping, kitchen and stores, because it carries revenue
  (`navigation.ts`, "THE MENU EACH PERSON WORKS FROM").
- **Words** (`HANDOVER.md` § 6): "Month so far" on the Dashboard, not MTD or
  PTD; the Manager report keeps PTD, as printed. `navigation.test.ts` fails on
  a Title Case menu label.
- **Terms explain themselves.** `src/lib/glossary.ts` lines 32–71 define
  occupancy, ADR, RevPAR, PTD, YTD, city ledger, guest ledger, no-show, day use
  and complimentary; lines 89–102 map the Manager report's printed labels to
  them. Every line was checked against the code that makes the figure —
  change a calculation, change its line (`glossary.ts` header;
  `HANDOVER.md` § 3.3). A linked Dashboard tile takes no term.
- **Start here**: reception's card is placed on the Dashboard
  (`startHereCards.ts` line 83, `START_HERE_ON`; `Dashboard.tsx` renders it).
- **Documents state facts from the session**, never a literal — the hotel's
  name and the person who ran it (`HANDOVER.md` § 6; MEMORY 256).
- **Definitions, once:** ADR and RevPAR are room revenue only — extras, food
  and tax are out (MEMORY 6; glossary); a discount is a printed row as well as
  a subtraction (MEMORY 43); the GST register is dated by business date, not
  the moment of issue (MEMORY 44); where a booking came from is
  `app.booking_source_label` (MEMORY 219).
- **Numbers that are real** (`DEFECTS.md` § "Numbers that are real, and one
  that is not"): 431 available room-nights was a 25-day figure, not a month;
  **the 175-room group total is unverified and must not appear anywhere.**
  Negative money is normal; a report with no rows still prints
  (`DEFECTS.md` § "Money").
- **Every list draws four states** (`HANDOVER.md` § 6).
- **Staff-first phase 2 — reports in the owner's layout — is ASK FIRST**
  (`HANDOVER.md` § 3.4). Open questions: a real `.xlsx` or the CSV Excel
  opens (`src/lib/csv.ts` avoids a spreadsheet library on purpose — do not add
  one unasked); PDF in the browser or on the server. The owner's eight eZee
  exports are in `D:\reports fidato\`, outside the repo — never commit them;
  `docs/REPORTS-SPEC.md` was derived from them.

---

## Open items

As of 17 September 2026, after the eight reports landed:

- **The owner's exports are matched in LAYOUT, not in figures.** The demo is not
  that day: it holds August's room-charge total (₹4,19,578.76 against the
  export's ₹4,19,578.77) and nothing else of 25 August — different guests and
  rooms, no restaurant bills, every payment in cash, no advance deposits. The
  owner's words, asked: *"it's the demo - what I need you to follow is the
  LAYOUT, but use MY BRANDING"*. Whether the demo is ever rebuilt from the
  exports is the owner's call.
- **Credit and debit cards print as one "Card" row** until Finance records them
  apart (D17-73, a request the master carried to that chat).
- **Finance's "Company accounts"** still reads balances by booking source; the
  owner has since decided it moves to the transfers this service counts
  (D17-86). Finance's screen, not this one.
- **Not recorded anywhere in this system, so always "-"**: service charges,
  tips, item discounts, Expense, a company's payment against its city ledger
  account, and commission paid to an OTA.
- **`listDailyStatistics`** still has no caller (PENDING § 4).
- REP-1 to REP-10 are fixed (`DEFECTS.md`).

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit     clean
          cd api && npm test             a scratch database; never `npx vitest run`
                                         inside api/ (MEMORY 196, 221, 264)
          cd api && npm run strip-check  the server's loader can parse every file (MEMORY 209)
database  db/tests/run.sh                a scratch database, dropped after
```

The guard this folder must respect: `src/test/boundaries.test.ts` — another
service reaches this one only through `index.ts`, and this one reaches others
only through theirs.

Where the checks are today: `api/test/modules/reports/reports.test.ts` (the
Manager report and the guest ledger agree, the GST sales register, the
cashier shift, the C-Form report, the city ledger, and — since 16 September —
the reports' dates in another month and financial year, and the Statistics
units); `statisticsSwitches.test.ts` (Monthly occupancy, Monthly and Yearly
statistics follow the two switches and say how they stand, D27-307). Web: `src/modules/reports/reports.test.tsx` ("the dashboard at /"),
`src/modules/reports/data/statistics.test.ts` (`monthOf`), `src/App.test.tsx`
("start here", "trade words explain themselves"),
`src/components/app/navigation.test.ts`. The database
suite has no group of its own for reports; new checks go in
`db/tests/modules/reports.sql`, which does not exist yet.

---

## Requests to the master

- **17 Sep · answered.** `dateReport` and `dateTimeReport` are in
  `src/lib/format.ts` and this service uses them (D17-77); the month-and-year
  formatter is still `monthOf` here. `src/lib/glossary.ts` now says a
  complimentary room counts as sold, and "Owed by guests, less refunds".
- **17 Sep · open.** `src/lib/glossary.ts` line 16 still says YTD is "FY_START,
  1 April, in both the API and here". There is no web copy and no `FY_START`: it
  is `financialYearStart()` in `api/src/modules/reports/builders/manager.ts`.
  The glossary's own YTD line, which a person reads, is still true.

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
