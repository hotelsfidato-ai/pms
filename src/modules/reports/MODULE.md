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

Before your first edit: claim the service in `HANDOVER.md` → "Folder claims"
(service, branch, date), read this file, then this folder's `MEMORY.md` and
`CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`.

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
| City ledger | `/reports/city-ledger` | `pages/Ledgers.tsx` (`CityLedgerPage`) | search only |
| No show | `/reports/no-show` | `pages/Ledgers.tsx` (`NoShowPage`) | search only |
| Lodging tax | `/reports/lodging-tax` | `pages/Ledgers.tsx` (`LodgingTaxPage`) | search only |
| Monthly occupancy | `/reports/monthly-occupancy` | `pages/Statistics.tsx` (`MonthlyOccupancyPage`) | search only |
| Monthly statistics | `/reports/monthly-stats` | `pages/Statistics.tsx` (`MonthlyStatisticsPage`) | search only |
| Yearly statistics | `/reports/yearly-stats` | `pages/Statistics.tsx` (`YearlyStatisticsPage`) | search only |
| GST sales register | `/reports/gst-sales` | `pages/Compliance.tsx` (`GstSalesPage`) | search only |
| Form F / C-Form | `/reports/c-form` | `pages/Compliance.tsx` (`CFormPage`) | search only |
| Guest ledger | `/reports/guest-ledger` | `pages/Compliance.tsx` (`GuestLedgerPage`) | search only |
| Cashier shift | `/reports/cashier-shift` | `pages/Compliance.tsx` (`CashierShiftPage`) | search only |

- "Search only" is `listed: false` in `nav.ts`: in nobody's sidebar, always
  reachable by Find a screen (Ctrl K) for a role that may open it.
- The Dashboard needs the `dashboard` grant; every report the `report` grant.
  Owner, admin, GM, hotel manager, finance and read-only see the Dashboard,
  All reports and Manager report in their menu. Housekeeping, the kitchen
  roles, the waiter and the store have no Dashboard in theirs.
- The Night audit entry sits in the menu's Reports section but belongs to the
  `night-audit` service.
- These routes carry no `/h/:code/` prefix and no `PropertyScope`; the pages
  read the hotel in view from the session (`useUi`).

---

## Server endpoints — 13

The code is in three files in `api/src/modules/reports/` (moved 15
September); the door `index.ts` mounts them at `/api/hotels`. Every one is a
GET.

From `reports.ts` (570 lines):

```
GET  /:code/reports/no-show
GET  /:code/reports/city-ledger
GET  /:code/reports/lodging-tax
GET  /:code/reports/guest-ledger
GET  /:code/reports/cashier-shift
GET  /:code/reports/gst-sales
GET  /:code/reports/c-form
```

From `statistics.ts` (316 lines):

```
GET  /:code/statistics/daily      reached by no screen — its only caller, listDailyStatistics, has none
GET  /:code/statistics/period     the Dashboard; the property page (admin)
GET  /:code/statistics/snapshot   the property page (admin)
GET  /:code/statistics/monthly    Monthly occupancy, Monthly statistics
GET  /:code/statistics/yearly     Yearly statistics
```

From `manager.ts` (332 lines):

```
GET  /:code/reports/manager       the Manager report and the Dashboard
```

---

## Data

```
data/reportData.ts     getNoShowReport, getCityLedger, getLodgingTax, getGuestLedger,
                       getCashierShift, getGstSales, getCForm, getMonthlyStatistics,
                       getYearlyStatistics.
data/statistics.ts     listDailyStatistics (no caller — KNOWN_UNREACHABLE in
                       src/data/repositories/repositories.test.ts), getPeriodStatistics,
                       getTodaySnapshot; re-exports PTD_FROM and PTD_TO from the core.
data/managerReport.ts  getManagerReport — the month so far starts on the first of the
                       report's own month (MEMORY 253). Also exports FY_START, which
                       nothing in the web app imports.
components/ReportShell.tsx   the report chrome: heading, the hotel and the person from the
                       session (useDocumentIdentity), print styling, CSV, and `Amount`,
                       which prints a dash for null, never a zero. Also ReportTable,
                       ReportHead, ReportBand.
```

---

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

- **front desk** — `listArrivalsOutstanding` and `getStayViewCounts`
  through `@/modules/front-desk`, on the Dashboard.
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
- **Numbers that are real** (`MEMORY.md` § "Numbers that are real, and one
  that is not"): 431 available room-nights was a 25-day figure, not a month;
  **the 175-room group total is unverified and must not appear anywhere.**
  Negative money is normal; a report with no rows still prints
  (`MEMORY.md` § "Money").
- **Every list draws four states** (`HANDOVER.md` § 6).
- **Staff-first phase 2 — reports in the owner's layout — is ASK FIRST**
  (`HANDOVER.md` § 3.4). Open questions: a real `.xlsx` or the CSV Excel
  opens (`src/lib/csv.ts` avoids a spreadsheet library on purpose — do not add
  one unasked); PDF in the browser or on the server. The owner's eight eZee
  exports are in `D:\reports fidato\`, outside the repo — never commit them;
  `docs/REPORTS-SPEC.md` was derived from them.

---

## Open items

From `PENDING.md` and `HANDOVER.md`, as of 15 September:

- **Staff-first phase 2** (`HANDOVER.md` § 3.4) — one report layout, PDF and
  Excel on every report, the Manager report's five missing sections, and the
  four-page Night Audit report. Done when each report for 25 Aug 2026 matches
  its PDF line by line. Ask first.
- **Two "in house" numbers for the same moment** — the property page
  (`getTodaySnapshot`) said In house 11, Vacant 9 while the Dashboard and Rooms
  said 10 and 7 (14 September). Needs one definition; the owner to choose
  (PENDING § 6; CHANGELOG 2026-09-14; MEMORY "Open").
- **The Manager report's City ledger section is all dashes** — it fills only
  when OTA balances are kept here; `manager.ts` says "when the channel bridge
  lands", and the channel manager is parked (PENDING § 6).
- **"Which room was this stay in" is written by hand** in two report
  queries — the guest ledger and the C-Form (`reports.ts`) — of the seven that
  could move onto `app.stay_room()` (PENDING § 6).
- **The same chart icon on six menu entries** — four are here: Manager
  report, Monthly occupancy, Monthly statistics, Yearly statistics
  (PENDING § 5a).
- **`listDailyStatistics`** has no caller (PENDING § 4).
- Found while writing this brief (15 September), in this folder's
  `MEMORY.md`: **REP-1** — Monthly occupancy and Monthly statistics always
  show August 2026, Yearly statistics always 2026; **REP-2** — the year to
  date always starts on 1 April 2026; **REP-3** — All reports is headed
  "Reports".

---

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

Where the checks are today: `api/test/reports.test.ts` (the Manager report
and the guest ledger agree, the GST sales register, the cashier shift, the
C-Form report, the city ledger) — moving to `api/test/modules/reports/`.
Web: `src/App.test.tsx` ("the dashboard at /", "start here", "trade words
explain themselves"), `src/components/app/navigation.test.ts`. The database
suite has no group of its own for reports; new checks go in
`db/tests/modules/reports.sql`, which does not exist yet.

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
