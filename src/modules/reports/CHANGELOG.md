# Changelog — reports

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-12 · The statistics follow the hotel's two switches (D27-307 (1))

Branch `worktree-agent-a47b6fc0afff69b37` (from cp6 9c55050e), copy `.claude\worktrees\agent-a47b6fc0afff69b37`.
**Asked for:** the owner's D27-307 (1): Monthly occupancy, Monthly statistics and Yearly statistics follow "A complimentary room counts as sold" and "A day use counts as half a room sold" through the shared figure, as the Manager report does; Night Sold and Complimentary stay separate columns; the footnote follows the switches.
**Shipped:** `figures.ts`: the switches are read by `soldRule()` (moved out of `dailyFigures()`, which still makes `sold` from it; no second definition). `builders/statistics.ts`: Occ %, ADR and the occupancy chart divide by `dailyFigures().sold` instead of adding paying and complimentary themselves; Night Sold (paying) and Complimentary print as before; the first footnote of all three reports now says how the switches stand, e.g. "Occupancy and ADR count rooms sold as this hotel's switches say (Settings, Front desk rules): a complimentary room counts as sold; a day use is not counted." Rev Par is unchanged (room charges over available rooms).
**Proved:** `api/test/modules/reports/statisticsSwitches.test.ts` (2 tests: the figures, the footnote), seen failing on the old code first: switch off read occupancy 50 and ADR 1,500 where 25 and 3,000 were due, and the footnote was fixed text; the defaults' figures passed on the old code too (the numbers do not move at the defaults). New code, through `.local/dbq.sh` + with-test-db.sh on 213 migrations: `test/modules/reports` + `test/reportFiles` 7 files, 64 tests, all pass. `bash scripts/gates.sh d27-307-stats quick`: web types 0, api types 0, strip 0; web tests 7 failed of 1,235, every one a 10-23 s timeout in another service's screen (accounting, connections health, CRS, finance bill controls, leads, reputation, new booking) - those 7 files alone: 47 of 47 pass. No web file changed.
**On screen** (a scratch copy of the demo, `fidato_sws`, dropped after; API 8831, web 5331; owner): 5EL, 9 Oct 2026 (13 paying, 1 complimentary, 2 day uses, 17 rooms). Defaults: Monthly statistics 9 Fri Occ 82.35%, ADR ₹3,473.49, the bar 82.35 - as before. Complimentary switched off on Front desk rules: 76.47%, ₹3,740.68, both bars 76.47, October 13.47% on Monthly and Yearly, every footnote "does not count as sold". Complimentary on and day use half on: 88.24%, ₹3,241.93, both bars 88.24, October 13.85%; the Manager report as on 9 Oct read the same (Sold Room 15, 88.24%, ₹3,241.93). Night Sold stayed 13 and Complimentary 1 throughout.
**Left open:** `src/lib/glossary.ts` (core) still says "A complimentary room counts as sold" for occupancy and ADR whatever the switch says; the switch's own description on Front desk rules says "On, as the owner's eZee reports count it." while it is off (front desk's). The manual's lines (chapters A11, A17, B3 on `manual-rest`) are listed for the master.

---

## 2026-10-05 · The City ledger's moves are the report's own again (D27-279 (6))

The credit limit counts the whole group now, through `app.company_owes` (migration 203), so `cityLedgerMoves` left the front door and is the report's own. Its comment names 203 as its twin: one meaning written twice, kept together.

## 2026-10-04 · The City ledger's moves, opened for the credit limit (D27-275 part 5)

`builders/cityLedger.ts`: the transfers, payments and moves the report sums are `cityLedgerMoves(hotel, to)` now, exported from the front door, so finance's credit limit sums one company's moves rather than a second calculation. The report's query is otherwise unchanged. **Proved:** the report's own tests in the API run of this session.

## 2026-10-03 · The Dashboard as sketched: today's work leads; All properties for the owner (D27-243) - the design lane's

Branch `design/dashboard-2oct` (from cp6 8c2860a7; 2493407c and 76f38f2a merged in), copy `.claude\worktrees\competent-leakey-110512`. Reports co-claimed BY FILE with the stock lane (the master's Q1, option B): Dashboard.tsx, AllProperties.tsx, Statistics builder, DEFECTS.md, dueOut.ts and its test, one line each in nav.ts, routes.tsx, the api index.ts and roleGate.ts. Screens read-only on the master's API (8787, `fidato`) from web 5391.
**Asked for:** the owner's D27-243: build the sketch of 2 October (`.local\screenshots\2026-10-02-dashboard-sketch\`): today's four tiles lead and open their lists, replacing Today's run and the small counts; colours by what staff must do; "ARR" on screens; Nights ahead on the Dashboard and the month's chart on Monthly statistics; Occupancy on its own row under 1440 px (REP-16); the Due out tile shows what departing guests still owe, to whoever sees money; "All properties" for the owner, replacing the table at the Dashboard's foot; last year only where there was one, saying how many; the business-date-behind line on the front desk's rule. Real figures only.
**Shipped:**
- `pages/Dashboard.tsx`: `WorkTile` (Arrivals, Due out, In house, Needs cleaning; `data-state` now/due/done/none: orange act now - someone leaving owes; yellow due today; green done; white nothing to do). Counts from the stays list and the Rooms board's counts, as Today's run counted them. "Average rate (ARR)". `NightsAhead`: tonight + 13 from GET /statistics/daily, the Calendar footer's rounding, a dash for a night with no figures, tonight navy, weekends washed, each opens the Calendar; on a phone it scrolls inside its card. Occupancy `min-[1440px]:col-span-5`. The house keeps its strip ("18 rooms · 9 empty · 1 out of service"). `CardTitle` puts its note under the heading on a phone. Today's run, `CountTile` and `EveryHotel` removed.
- `GET /api/hotels/:code/due-out` (`api/src/modules/reports/dueOut.ts`): who leaves on the business date and has not, how many owe on their own bills (the night audit's half-rupee rule), how much (finance's `folioBalance`). roleGate `MONEY_REPORT` (`invoice`, D27-147: not the revenue manager); the web asks only when `can(role, "view", "invoice")` (`data/dueOut.ts`).
- Monthly statistics carries the month's occupancy chart: `occupancyChart()` in `builders/statistics.ts`, shared with Monthly occupancy.
- `pages/AllProperties.tsx`, `/all-properties`, Across properties, for who may add a property (`can(role, "create", "hotel")`): the group in navy (today, month so far, month last year; "Last year: n of m properties"), "Needs you" (business date behind first, on the front desk's rule - `daysBehind()` now exported from `BusinessDateBehind.tsx`, its own words - then each property's bell notices that ask for action), a row per property (a card on a phone).
- Core, approved by the master: the glossary's `adr` term reads "Average rate (ARR)" (its (i) matched the label).
**Found:** (1) The app keeps one query cache for every test in a file, so a read made by an earlier render is never asked again: the due-out and nights tests render the page alone with a fresh client. (2) "Needs cleaning" needs 156px of label where a phone tile has 134: its arrow ran 8px past the tile until it moved to the tile's edge. (3) On the master's API (cp6) the new route answers 404, so the tile shows its fallback, "3 still to leave", until this merges; read from the open bills, it will then say "3 owe ₹11,495" (rooms 204, 201, 202) in orange.
**Proved:** web `dashboard.test.tsx` 9 (all failed on the old Dashboard first; the business-date line failed before its code), `reports.test.tsx` 5 (the own-day test moved to All properties), with reports, the shell, navigation, the front desk's banner test, primaryAction and boundaries: 11 files, 84 tests. API through `.local/dbq.sh` + with-test-db.sh: 3 files, 106 tests on 186 migrations (`dueOut.test.ts` 3, failed first; reports 31; roleGate 72). Both tsc clean. REP-16 measured (DEFECTS.md).
**On screen** (`.local\screenshots\2026-10-02-dashboard-build\`): owner at 1280 (tiles level, Occupancy 966px on its own row, figure tiles 314px, every row 21px), 1366 (343px), 1440 (211px beside Occupancy, amounts on one top), 375 (no size off the ladder, nothing sideways, labels whole, notes on two lines, 4 nights whole and a fifth peeking); All properties at 1280 and 375 (its figures equal the Dashboard's; "Last year: 0 of 1 properties"; the business-date line first). GM and reception: the Dashboard's tiles; All properties not in their menu, and its address refuses them.
**Left open:** "Needs you" colours every bell notice that asks for action orange; a notice that is due today rather than late (an arrival still to come) is orange too until the bell says which is which. The reports MODULE.md does not yet describe the tiles and All properties (left for the stock lane's merge to settle first).

---

## 2026-10-02 · The Store's reports on migration 180: costs at their moment, GST, expiry, departments, breakage (D27-242)

Branch `reports/stock-3a-2oct`, after merging cp6 f6eee640 (8a1d3964) and
7a074245.

**Asked for:** the master: wire the stores lane's 180 - `stock_movement_costs`,
`food_cost_basis` 'before_gst' (the owner's D27-242), outlet sales, crockery,
department as free text; and swap the Store's copy of the menu for this
service's exports.

**Shipped:** `builders/stock.ts` values every movement with
`app.stock_movement_costs` (the weighted average of deliveries is gone).
Closing stock adds "Near expiry" (30 days, or past, while still held).
Movement by day adds Broken. Consumption adds till sales and the food cost
per outlet, both before GST, to readers holding `report` only, and "Per
department" ("(not said)" last). Wastage and breakage are two sections; a
breakage names who broke it. Count differences read `stock_count_lines`, with
"Last counted". Dead stock counts a breakage as out. Supplier spend adds GST
and GST claimable. `STOCK_REPORT_LINKS` joins `mayReadStockReports` and
`STOCK_REPORTS_PATH` in `@/modules/reports` for the Store's Reports menu. The
Store's own files are back as cp6 has them: the master swaps its copy at
merge (their word of 2 Oct, after 2a8f924b had swapped it; that commit's
stores half can be cherry-picked).

**Found:** the test run sat in the DB queue behind another lane and loaded
the new builder, so it never ran red against the old one. The old builder has
none of the sections the new test asserts (`expiry`, `departments`,
`breakage`, `last`), so it could not have passed.

**Proved:** stockReports 11; tsc 0 (api and web); strip-check 193; web
reports, stores, navigation, src/test (11 files, 64) and primaryAction.

**Left open:** nothing of the 180 wiring.

---

## 2026-10-02 · The Store and equipment reports (phase 3A; D27-238, D27-240)

Branch `reports/stock-3a-2oct` (from cp6 3336a219), copy
`.claudeworktreeslaughing-jepsen-2b2ea7`, database `fidato_s41`, API 8891, web 5291.

**Asked for:** phase 3A of docs/STOCK-AND-EQUIPMENT-PLAN.md, planned first;
the owner's answers D27-240 (R-1 readers, R-2 costs as recorded, R-3 dead
means nothing went out, R-4 days of cover at the last 7 days' use).

**Shipped:** nine builders (`builders/stock.ts`, `builders/equipment.ts`)
and their keys, routes, read rules (`STORE_REPORTS`), downloads
(`reportFiles.ts` `STORE_EXPORTERS`, the master's T-2), pages
(`pages/Store.tsx`), menu entries and the "Store and equipment" group in
All reports.

**Found:** two labels too long for the sidebar and an order taken by the
accounting export (navigation.test caught both; renamed "Closing stock" and
"Supplier spend", orders 150-230).

**Proved:** see the root report of 2 Oct to the master: stockReports.test
(9) failed first and passes; roleGate, reportFiles, reports; web reports,
navigation, src/test and primaryAction; screens.

**Then (resumed, 2 Oct):** `STOCK_REPORTS_PATH` ("/reports/store", a "Store
reports" page with the nine, open to the Inventory Manager, who cannot open All
reports) and `mayReadStockReports(role)` exported from `@/modules/reports` for the
Store page's button (storeReports.test failed first, passes). Proved after the
commit: stockReports 9, roleGate 70, reportFiles 15, reports 31 (API, one file at
a time); tsc 0; web reports and navigation. The earlier "no tests" failure was a
crashed worker under memory pressure (the same crash hit web runs that day; the
file passes alone). Screens on fidato_s41 at 179 with a few items received,
issued, wasted and counted through the Store's own API: all nine as the Owner,
figures checked by hand; Store reports as the Inventory Manager, All reports
refused to them.

**Left open:** the stores lane's columns (their 183, not on cp6 yet; marked
STORES LANE in the builders).

---

## 2026-10-02 · The City ledger counts what companies paid (the owner's D27-239) - the cash lane's

**Asked for:** the master, with the owner's answer: Opening, Credit and Closing
in the City ledger from recorded company payments; Opening counts all history.
**Shipped:** `cityLedger.ts`: Opening is everything sent less everything paid
before the period, Credit is finance's `company_payments` by the day received,
Closing is Opening + Debit - Credit. `manager.ts`'s City Ledger section:
Opening Balance and Closing Balance (today), Payment Received (today, month,
year). `reports.test.ts`'s City ledger case follows the new Closing.
**Proved:** finance's `companyPayments.test.ts` (ledger and Manager lines);
`test/modules/reports`: 3 files, 33 tests, passed.
**Left open:** Outstanding Commission stays "not held".

---

## 2026-09-29 · A night not charged yet at a property with no room GST rule: its tax unknown, not a 500 (D27-173) - the leads lane's

**Asked for:** the master, after the leads lane found it: `NIGHTS`' booked
nights priced their tax with `app.gst_rate`, which raises where a property has
no room GST rule (a new one has none, D22-9, and it can take bookings). Every
reader of `NIGHTS` - the Dashboard, the Manager report, Statistics, the Night
audit report, the accounting day book, marketing's numbers - answered
"Something went wrong" for such a property.
**Shipped:** `figures.ts`: booked nights' tax through `app.gst_rate_or_null`;
the rent unchanged. A day's room tax is null when any night that day has an
unknown tax (not the others' sum); `DayFigures.roomTax` and `StayNight.tax` are
`number | null`; `sumDays` carries the null. Dashes, never 0: the Manager report
(room tax and everything it adds into: SGST, CGST, total tax, revenue with tax,
transfer to the guest ledger), Statistics (tax), the Night audit report (the
stay's tax and rent with tax, Room Sales' tax, the tax and sales totals).
Posting a charge still refuses without a rule: night-audit and front-desk
operations untouched.
**Proved:** `api/test/modules/reports/nightsNoRoomRule.test.ts`: a new property,
a future booking, no room rule: `dailyFigures` answers 2,500 a night with a null
tax and `sumDays` a null; with a 12% rule, 300 a night. Run results: the leads
lane's CHANGELOG.
**Left open:** nothing here.
## 2026-09-28 · Fix round F (QA leftovers, D27-149), part B: the owner's answers to RP-1 and RP-2 (D27-151, D27-152)

**Shipped:** `DocumentReport.tsx`: the Manager report is read afresh each time it opens (staleTime 0, refetch on mount), as the Dashboard's copy is - kept for the session it showed a booking voided since as still sold (D27-151; the Calendar and rate screens follow in part D). `builders/manager.ts`: under the City ledger, "Opening, Payment received and Closing need a company's payment, which this system does not record yet." (D27-152; the dashes stay, D17-74).

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149): the Manager report's two ledger figures, its complimentary rows, the cashier's name, the lodging tax line

**Asked for:** QA RP-3 to RP-6 (`docs/qa/qa-2026-09-28.md`). Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:**
- RP-3: a footnote under the Manager report saying why "Transfer Charges to Guest Ledger" (the day's revenue with tax, each night on its night, tonight at the booking's rate until posted) and "Charge Posted to Guest Ledger" (what was posted to the bills that day, a stay posted on arrival counted whole, refunds in) differ. No figure changed. Checked for 25 Aug on fidato_s30: ₹25,557.79 against ₹35,940.73, the gap being the multi-night room lines posted on the 25th (₹28,899.60 over six lines).
- RP-4: the Cashier shift names the clerk through `app.hotel_people` (149), so the Accountant sees "Test Reception", not "not on record" (REP-14).
- RP-5: "Complimentary Room | Complimentary Day Use" is two rows, counts each (and "Complimentary Room" now finds its glossary term).
- RP-6: All reports says "CGST and SGST at each slab's rate" (was "at 2.5% each, split by tax slab": the sheet is by day, not by slab).
- The Cashier shift's note lost its long dash.
**Proved:** `api/test/modules/reports/reports.test.ts` 31 passed; the new RP-4 test failed with `reports.ts` put back ("expected null to be 'RPTEST clerk'"). Web `src/modules/reports` tests passed. On screen: the Manager report's two rows and the footnote, the Cashier shift as Test Accountant ("Test Reception · UPI · 1 · ₹10"), All reports' Lodging tax line.
**Left open:** RP-1 (four occupancy definitions) and RP-2 (City ledger dashes are D17-74) are with the master as questions; nothing changed for either.

---

## 2026-09-27 · Form III at the desk (D27-25) - the guests lane's

The guests lane (`guests/form-iii-27sep`) changed this service's files for
Form III, written in full in the guests changelog of the same day: `/reports/c-form` reads the guests service's `app.form_iii` (147) and is "Form III register": the screen shows arrival, departure and the portal numbers, and the download every Form III field in the form's order (`reports.ts`, `pages/Compliance.tsx`, `data/reportData.ts`, `nav.ts`, `pages/Index.tsx`).

---

## 2026-09-27 · The Night audit report's restaurant lines name their outlet and order (D27-1)

**Asked for:** D27-1 - Misc. Charges joined `pos_orders.id = fp.source_id`,
but a till line's source is its TICKET, so Outlet and Order were never filled.
The owner (27 September): an outside till's line shows its outlet only.
**Shipped:** `builders/nightAudit.ts` reads the outlet from `pos_tickets` and
the hotel's own till's order by the ticket's number (`split_part(ticket_ref,
'/', 1)`, the order number, "/rate" on a split bill). **Proved:**
`till.test.ts` "names its outlet and order on the Night audit report" and
`pos.test.ts` "names the outlet on the Night audit report's charge, and no
order" - both null on cp6's builder. On screen: "Outlet: Fidato Restaurant,
Order 20260825-2". The six checks: the POS changelog's entry of the same day.
**Left open:** nothing here.

---

## 2026-09-26 · The C-Form report for the check-in roles only (D25-38)

**Asked for / Shipped:** the compliance lane (in full in the front desk's
changelog, 26 September). `GET /reports/c-form` asks the role (roleGate
`READ_RULES`: owner, admin, GM, hotel manager, reception); its menu entry
(`canSee`), route guard (`RequireAccess`) and the All reports list and starred
list (`mayReach`) no longer offer it to anybody else. **Proved:** the role
gate's D25-38 tests (housekeeping, kitchen, chef, till operator, accountant and
viewer refused in the gate's words; reception, hotel manager, owner answered),
seen failing with the rule taken out; `guestIdReaders.test.ts`.

---

## 2026-09-24 · Lodging tax without alcohol (D22-45); no invented GST rate in its heading (D22-9); the outlets' sales counted once (ACC-11)

Done from the finance session (the owner's list for 24 September), in this
service's files because the figures live here.

**Shipped:**
- `builders/lodgingTax.ts`: the sheet reads the bill's GST lines only
  (`tax_scheme = 'gst'`), so Other Bills carries no alcohol and no VAT; a
  footnote says so (REP-12, D22-45).
- `figures.ts` `Property.cgstRate`/`sgstRate` are null where a hotel has no
  rate (D22-9: new hotels have none), and the heading reads "CGST @-", never
  "0%" - and then, the owner's D24-23, no rate at all: "CGST", "SGST"
  (REP-13 fixed; `Property.cgstRate`/`sgstRate` removed, nothing else read
  them).
- `figures.ts` `posSales` leaves out a bill settled to a room, which the
  room's folio already carries: the day book, its only reader, counted it
  twice (accounting's ACC-11, fixed with the owner's yes).

**Proved:** `api/test/modules/reports/lodgingTaxAlcohol.test.ts` (Other
Bills ₹1,050 not ₹1,600; the heading "CGST @-"), failing with the filter
taken out; `accounting/dayBook.test.ts` for ACC-11. On screen: Lodging tax,
August 2026, Other Bills ₹0.00 on a bill with a room and ₹550 of whisky and
VAT (₹126.00 when a laundry line was on it too).

---

## 2026-09-21 · The Dashboard, easier to read (the master, for the owner)

**Asked for:** the owner — "fix the UI/UX in the dashboard, make it more
readable", with the design system, the taste skill and the impeccable skill.
The Dashboard (`/`) only; a polish pass, not a redesign.

**Shipped** (`pages/Dashboard.tsx`; every figure is the one it was)
- **The month and the year under a figure are a label and a value** in two
  columns, set off by one hairline, not a sentence in grey: "Month so far
  ₹4,09,690" became "Month so far" on the left and ₹4,09,690 on the right. The
  money collected today is broken down the same way, one row per way of
  paying, instead of packed behind middle dots.
- **A section's note sits under its heading** — the design system's own
  `Section` replaces the page's one-off header, whose note floated at the far
  right of the line and whose heading was a size smaller than every other
  section heading in the app.
- **Two by two, not three and an orphan.** The four lead tiles and the four
  money tiles sat three to a row between 768 and 1280 pixels wide, leaving the
  fourth alone; they are now two by two there, and one to a row on a phone,
  where two across wrapped "Month so far" away from its number.
- **The six counts line up.** A count sits at the foot of its tile and its
  chevron beside it, so "Needs cleaning" running to two lines no longer drops
  its number below the others' — and the label gets the chevron's width back.
- **A dash reads as absent**: the rule's dash keeps its size but takes the
  secondary grey, so it is not read as a figure.
- **The page line wraps between its parts**, with the dot at the end of a
  line, never the start of one.
- **A read that fails says so** ("Today's figures did not load", with Try
  again). It printed the same dashes as "not held yet" and nothing else — a
  server fault read as a business with no figures. "Nothing taken yet today"
  also showed while the figures were still loading; it no longer does.

**Proved:** `npx tsc -b --force` clean; `vitest run src/modules/reports
src/App.test.tsx` 43 passed, then 44 with the new test; the new test — the
Manager report's read failing with a 500 — seen to fail with the error line
taken out, and pass with it back. Looked at on the demo data at 1440, 1024 and
390 pixels wide: no sideways scroll at 390. The design detector found nothing.

**The finishing pass, the same evening** (the owner chose "finish it" over
another round of looks)
- **Found: the table of every property read every row on the date of the
  hotel in view.** `buildRows` used `BUSINESS_DATE` and the period that goes
  with it for each property, so with one hotel a day behind another its
  arrivals due, rooms to clean and month so far were the other hotel's day.
  Each row now reads its own hotel's business date and its own month. Only
  an owner of more than one hotel sees this table, which is why the demo
  never showed it.
- That table says when its figures failed to load, instead of drawing an
  empty table, which reads as a group with no hotels.
- A tile's focus ring follows the tile's own corner, two pixels out; the
  arrow beside a property's name shows on keyboard focus too, and is hidden
  from screen readers.
- **Proved:** 45 passed (`vitest run src/modules/reports src/App.test.tsx`);
  the new test (two hotels, 25 August and 2 September) seen to fail with the
  old date put back and pass with the fix; in the running app, the manager
  report forced to answer 500 shows "Today's figures did not load" with Try
  again, and Tab from RevPAR lands on the Arrivals tile with its ring drawn.

**Left open**
- The City ledger tile's note ("A balance waits on their payments being
  recorded") is hard to follow; its words are the owner's to change, not mine.
- Not touched: the tile idea itself (icon, label, big figure). Changing it
  would be a redesign, which was not asked for.

## 2026-09-18 · The owner's answers on what the reports print (D17-93 to D17-99)

**Asked for:** the seven questions this service left with the owner, answered
through the master. Six needed nothing; one was a change.

**Shipped**
- **D17-93 · available room-nights start at the property's first trading day.**
  `firstTradingDay()` in `figures.ts`, beside the other shared definitions: the
  earliest arrival or the earliest day anything was posted, whichever came
  first. `dailyFigures()` counts nothing available before it, so the Manager
  report, Monthly and Yearly statistics and the occupancy chart all say the same
  thing about a year. A property that has never traded is not held back by it.
  Every report that prints an available figure now says which day it counted
  from: *"Available rooms are counted from 02/08/2026, the day this property
  first traded."*
- **D17-97 · Cancellation Sales prints "-"** on the Night audit's Daily Sales.
  Nothing in this system charges a cancellation fee, so there is nothing to
  count — and the total still adds up the rows that do.
- **D17-99 · the lodging tax sheet says the accountant confirms it** before
  anything is filed from it. On the report, not only in a note here.
- REP-11 closed as answered (D17-94, leave the not-yet-arrived booking); the
  meal plan stays as Rate Type (D17-95), Extra Charges stay as the desk posts
  them (D17-96), Block Room keeps this system's count (D17-98).

**Proved** — in `D:\fidato-reports`
- API reports tests 37/37, with `businessDate` alongside: 37 green together.
- **Four deliberate breaks, each failing its own test** and then restored:
  counting the house before the property traded (2 tests, including the YTD
  window one), Block Room back to zero, Cancellation Sales back to zeros, and
  the accountant's sentence removed.
- A test of mine was wrong first: it counted blocked nights from the first
  trading day while the report counts them over its own YTD window, and another
  fixture in the same run posts in March. The report was right; the test now
  measures the window the report was asked for.
- The year on screen: January to July show nothing, August counts from the 2nd
  (516 room-nights, not 533), and the footnote names 02/08/2026.

**Found**
- **Block Room would have counted every night before go-live as a room held
  back.** It was the room count times the days, less what was available - and
  once available started at the first trading day, a YTD from 1 April against a
  property that opened on 2 August read 2,238 blocked room-nights instead of 18.
  Caught by reading the consequence of the change before committing it, not by a
  test. Block Room is now counted day by day in `figures.ts`, beside available,
  and is nil before the property traded.
- The REP-2 window test compared the YTD room-nights against the database's raw
  `sellable_rooms` sum, which is no longer the definition. It counts from the
  later of the window and the first trading day now, so it still fails on a year
  that starts on the wrong 1 April — which is what it is for.

**Left open** — nothing on this service. The bills and vouchers (D17-63/64) wait
on the owner saving CRS voucher FH-2026-00002 into the reports folder.

---

## 2026-09-17 · Every report in the owner's layout (D17-62)

**Asked for:** all eight reports in `docs/REPORTS-SPEC.md` laid out like the
owner's eZee exports in `D:\reports fidato\` - Night Audit, Manager report with
its five missing sections, City Ledger, No Show, Monthly Occupancy, Monthly and
Yearly Statistics, Lodging Tax - with the master building the shared PDF, .xlsx,
CSV and the report layout, and the long dash out of this folder.

**The owner's answers first.** Their PDFs cannot be matched figure by figure:
the demo holds August's room-charge total (₹4,19,578.76 against the export's
₹4,19,578.77) and nothing else of that day - different guests and rooms, no
restaurant bills, every payment in cash, no advance deposits. Asked, the owner
said: *"it's the demo - what I need you to follow is the LAYOUT, but use MY
BRANDING"*. Then, in two rounds (recorded by the master as D17-70 to D17-78):
room charges are reported on the night they pay for; a complimentary room counts
as sold; the card split is a request to Finance; the City ledger counts bills
transferred to a company and claims no balance it cannot know; Outstanding
Commission is "-"; "Folio No." prints the booking reference; dates print
25/08/2026; the printed Night audit lives in All reports.

**Shipped** - branch `reports/ezee-layout`, copy `D:\fidato-reports`
- **One document per report.** `api/src/modules/reports/document.ts` (the
  contract agreed with the master), `build.ts`'s `buildReport()` at the front
  door, a route per report in `documents.ts`, and `components/ReportView.tsx`
  which draws any of them: bands, spanning headings, totals ruled off, negatives
  in red, "-" for a figure this system does not hold, and the chart.
- **One derivation.** `figures.ts` holds the nights as one piece of SQL:
  a posting that says "· N nights" is split evenly over those nights (the paise
  to the last), a night not posted yet from the business date on counts at the
  booking's rate, a complimentary room is sold. `dailyFigures()` adds them up by
  date; `stayNights()` reads them room by room. The Dashboard, the property page
  and every report read these.
- **The eight**: Monthly statistics, Monthly occupancy (the bar chart with its
  value labels), Yearly statistics, No show, City ledger (with eZee's "Ignore
  zero balance account" switch), the **Manager report** with all thirteen
  sections including the five that were missing - Advance Deposit Ledger, POS
  Summary, POS Payment Summary, Revenue Summary and the eZee Room Summary rows -
  the **Night audit report**, four pages and thirteen sections, which this
  system has never had, and **Lodging tax** from the invoices.
- **The files.** PDF, Excel and CSV buttons on every report screen, fetched
  through the master's `downloadFile`, disabled until the report has loaded, and
  the server's own sentence shown when one is refused.
- The long dash is gone from what a person reads in this folder.

**Found**
- **REP-8, mine:** the reports tests posted ₹2,734.50 into the demo property and
  left it there, so the API suite went red on `businessDate.test.ts`, which
  reads that calibrated total. Found by the master, not by me. Every posting is
  now reversed in `afterAll` and the teardown measures the property's payments
  back to where they were; what cannot be undone (a settled restaurant bill, an
  invoice) is counted instead.
- **A bill transferred to the city ledger counted as money received.** It is a
  payment posting and nobody has paid it: out of Receipt, out of Total Payment,
  out of the cashier shift; it is Charges Raised.
- **A label in a date column printed as a dash** ("Total" through `dateShort`).
  Found by ReportView's own new test.
- **Not mine, told to the master:** `npm run strip-check` was red on cp6 -
  `su/client.ts` and `su/token.ts` use constructor parameter properties, which
  the server cannot load. The next deploy would not have started.

**Proved** - every number below was run in `D:\fidato-reports` on the tree that
was committed, and judged by its exit code (MEMORY 274, 285)
- **The gates, on the finished branch:** web `npx tsc -b --force` clean ·
  `npx vitest run` **362 passed, 41 files**, exit 0 · api `npx tsc --noEmit`
  clean · `npm run strip-check` 86 files · `cd api && npm test` **958 passed, 1
  failed** · `bash db/tests/run.sh` **787 assertions passed** · `npm run build`
  clean, "no test sign-in in dist" · `npm run lane -- reports` all inside the
  lane (the files it lists outside are cp6's own commits this branch carries
  through the merge).
- **The one failing API test was the master's**, not this service's:
  `test/reportFiles.test.ts` asserted that a report "not built yet" cannot be
  downloaded, and after this work there is no key in `REPORT_KEYS` that is not in
  `BUILT_KEYS`. Told to the master with the fix; they had already made it.
- API reports tests 34/34, with `businessDate` alongside them: 34 green together.
- **Eleven deliberate breaks, each seen to fail its own test**, each restored:
  the night split, booked-ahead nights, comps counted as sold, an unknown report
  key, the no-show day, city-ledger transfers only, a transfer counted as a
  receipt, the guest ledger's settlement, POS tax, the discount inside extras,
  the deposit collected today, and the teardown's own measurement.
- On screen at 25 Aug 2026, every report opened and read: Monthly statistics
  (533 available room-nights), Monthly occupancy, Yearly statistics, No show
  (empty, with its date), City ledger, Manager report (all thirteen sections),
  Night audit report, Lodging tax. A PDF downloaded from the Monthly statistics
  screen: `GET /reports/monthly-statistics.pdf` → 200.

**Left open**
- The owner's PDFs are matched in LAYOUT, not in figures: the demo is not that
  day. Whether the demo should one day be rebuilt from the exports is the
  owner's call.
- Finance's "Company accounts" screen still shows balances by booking source
  (`/reports/balances-by-source`); the owner has since decided it moves to the
  transfers (D17-86) - the master has the Finance chat.
- Credit and debit cards print as one "Card" row until Finance records them
  apart (D17-73).
- Service charges, tips, item discounts and Expense are not recorded anywhere in
  this system, and print "-".

**Commits:** `b418833` (the three statistics reports) · `2b95465` (No show, City
ledger) · `2996129` (the Manager report) · `8fd1cc3` (dates as 25/08/2026) ·
`3800355` (the Night audit report, and the money the tests left in 5EL put back)
· `73626fb` (Lodging tax, the PDF/Excel/CSV buttons, the long dash) · `1d4ed60`
(two report cards whose words the new figures had outdated) · `11f89ce` and
`76102fe`, the two merges of cp6 this branch carries.

---

## 2026-09-16 · Round 1: the typed-in dates, the heading, the STATISTICS block

**Asked for:** round 1 for reports (`HANDOVER.md` § 3.0g), in order — REP-1
and REP-2, the typed-in dates, derived from the business date and proved with
a date in a different month and a different financial year; then REP-3, the
STATISTICS block through `money()` and `percent()`, and the footer timestamp
labelled "Printed". Not to change how rooms, in-house guests or ADR are
counted. To bring the owner the wording for "Owed by guests" rather than
change it.

**Shipped** — branch `reports/typed-dates`, copy `D:\fidato-reports`
- REP-1 · `data/statistics.ts` `monthOf(date)`; `pages/Statistics.tsx` asks
  for and prints the business date's month and year, with the month in the
  query key. `data/reportData.ts`: the monthly and yearly ranges have no
  default; No show, City ledger and Lodging tax default to `PTD_FROM`, not
  "2026-08-01". `api/.../statistics.ts`: the yearly grid defaults to the
  business date's year, not 2026.
- REP-2 · `api/.../manager.ts` `financialYearStart(asOn)` replaces
  `FY_START = "2026-04-01"`; the unread web copy in `data/managerReport.ts`
  is gone.
- REP-4 (found writing REP-2's test) · the server's default PTD start is the
  first of the report's own month, not the business date's.
- REP-3 · `pages/Index.tsx` is headed "All reports".
- REP-5 · the Manager report's Statistics rows carry `unit` from the server
  and print through `money()` and `percent(n, 2)`; `components/ReportShell.tsx`
  labels its stamp "Printed".
- Tests: four in `api/test/modules/reports/reports.test.ts`, two in
  `data/statistics.test.ts`.
- `DEFECTS.md` (REP-1 to REP-5 fixed; REP-6 open, REP-7 mine) and `MODULE.md`
  (data, server dates, open items, tests, three requests to the master).

**Found**
- **REP-6, open, the owner's** — "Owed by guests" is Folios' Net position:
  on the lane's data Outstanding ₹63,440 − Overpaid ₹784 = ₹62,656, shown as
  "Owed by guests ₹62,656 · Every guest bill still open". Brought to the owner
  with wording; nothing changed.
- REP-4, above, fixed.
- REP-7, mine — a deliberate break that did not apply (CRLF), caught by
  counting the break runs, re-run and seen to fail.
- For the master, not this service's: a fresh lane database from
  `DB=… ./db/migrate.sh --with-dev-identities` has no demo — dev identities
  error ("expected 3 staff with dev uids, found 0") and the script still
  prints a green tick after it; `load-demo` then fails on `undefined.id`
  because the demo staff come from `db/tests/suite.sql`. What worked here is
  the API harness's order: migrations → `harness.sql` + `suite.sql` →
  `dev-identities.sql` → `load-demo` with `SUPER_DATABASE_URL` on the lane's
  database. And in a lane copy whose `node_modules` is a junction, Vite
  refuses the Inter font (403 on `/@fs/D:/fidato pms/node_modules/…`), so
  lane screens render in the fallback font.
- `app.current_fin_year()` (017) reads the wall clock, not the business date —
  finance's invoice series, not changed; noted for whoever holds finance.

**Proved** — run in `D:\fidato-reports` on 16 September
- Deliberate breaks, each seen to fail with its own message, each restored:
  the 1 April 2026 literal (3 API tests; YTD room-nights as on 10 May 2027
  were 6,891 instead of 680); PTD from the business date's month (1 API test,
  "period start for 2027-02-10: expected '2026-08-01'"); `?? 2026` for the
  yearly grid (1 API test, months '2026-01'… instead of '2027-01'…); the
  units removed (1 API test); August put back in `monthOf` (2 web tests).
- On screen, the lane's API and web against `fidato_reports`, with 5EL's
  business date moved in that database and put back to 25 Aug 2026:
  at 10 May 2027 Monthly statistics "May 2027" (1–31 May), Monthly occupancy
  "May 2027", Yearly statistics "2027", Manager report "PTD from 1 May 2027 ·
  YTD from 1 Apr 2027" with 680 YTD room-nights; at 10 Feb 2027 Monthly
  statistics "February 2027" (1–28 Feb) and Manager report "YTD from 1 Apr
  2026" carrying ₹4,19,579 of August's room charges; at 25 Aug 2026 the
  Statistics block reads 29.41% · 30.63% · 5.27%, ₹5,505 · ₹3,179 · ₹3,179,
  ₹1,619 · ₹974 · ₹168 — the Dashboard tiles' figures exactly — and the
  footer "Printed 16/09/2026, 06:36:00 pm"; All reports' heading, menu entry
  and tab all "All reports". Console after a mark: no application errors;
  the only failures were the font 403s above. Every API call 200.
- Gates, by exit code: `npx tsc -b --force` 0 · `cd api && npx tsc --noEmit`
  0 · `npm run strip-check` 0 (69 files) · `npx vitest run` 0, 214 passed in
  20 files · `cd api && npm test` 0, 374 passed in 29 files · `bash
  db/tests/run.sh` 0, all 622 assertions · `npm run build` 0, "no test
  sign-in in dist" · `npm run lane -- reports` 0, all inside the lane.
- To start the previews, `D:\fidato pms\.claude\launch.json` — the master's
  checkout — carried two extra entries for a few minutes; restored, and
  its SHA-256 checked identical to before, with that checkout clean.

**Left open**
- REP-6, the owner's wording; then the `guestLedger` glossary line (master).
- A month chooser on the monthly reports was not built: the owner was asked
  earlier on 16 September and has not answered; the pages show the business
  date's month.
- Not in round 1, recorded in `MODULE.md` open items: "Stage 9" in the City
  ledger note; occupancy printed with a local `${n}%` on Monthly and Yearly
  statistics and the Dashboard; Room Summary counts ungrouped; ADR and RevPAR
  `₹0` on a day with nothing sold (ADR is the master's); Monthly occupancy's
  note about a fortnight describes August 2026.
- Three requests to the master in `MODULE.md`: a `monthYear()` in
  `format.ts`, the glossary header's `FY_START` line, and the `guestLedger`
  line after REP-6.
- Not merged, not deployed — the master merges.

**Commits:** the commit on `reports/typed-dates` that adds this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the Dashboard and twelve report entries,
  ten of them search-only; `routes.tsx`; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/reports/index.ts`, which mounts
  `statistics.ts`, `reports.ts` and `manager.ts`.
- Step 4 (`295c176`): moved in — `components/ReportShell.tsx` (from
  `src/components/reports/`); `data/` managerReport, reportData, statistics
  (from `src/data/repositories/`); pages Compliance, Index, Ledgers,
  ManagerReport, Statistics (from `src/pages/reports/`) and Dashboard (from
  `src/pages/`). The door gained `getCityLedger` for finance's Billing and the
  statistics reads for admin's property page.
- `e754c49`: the data files take the business date from the core.
- This brief: `MODULE.md` rewritten from the code — thirteen screens, 13
  endpoints, what it reads, the rules; this file; `DEFECTS.md` with three new
  entries and eleven root entries indexed.

**Found** (while writing the brief, by reading the code)
- REP-1 · Monthly occupancy and Monthly statistics always show August 2026;
  Yearly statistics always 2026.
- REP-2 · the year to date always starts on 1 April 2026.
- REP-3 · All reports is headed "Reports".

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored) —
  and the same 31 failed with the brief-only folders taken out. Every run also
  reports 2 unhandled rejections from `src/lib/outbox.ts` under jsdom.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- REP-1, REP-2, REP-3 — not fixed.
- The server code is still in `api/src/routes/reports.ts`, `statistics.ts`
  and `manager.ts`; moving it is step 5, in progress elsewhere.
- `api/test/reports.test.ts` and the report tests in `src/App.test.tsx` have
  not moved (step 7).
- Staff-first phase 2 (reports in the owner's layout) — ask first
  (`HANDOVER.md` § 3.4).

**Commits:** `e9dd6b1` · `295c176` · `e754c49`, and the commit that added
this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 10, "Group dashboard and reports") are the record.
