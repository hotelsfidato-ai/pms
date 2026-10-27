# Defects — reports

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `REP-1`, `REP-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None.

## Fixed

### REP-20 · From 640 to about 690 wide the Dashboard's three figure tiles broke "Month so far" and "Year so far" onto two lines - FIXED 27 October (D27-369)

**Found** - 26 October, measuring the chart row's build in the browser pane on the local demo. At 640 wide each tile is 149px: "Month so far ₹1,72,972" and "Year so far ₹58,14,872" are 42px tall (two lines) against 21px, so the amounts stop being level (the Level Rule). At 700 (169px) they fit. It is REP-16 again, one step lower: REP-16 moved Occupancy to its own row under 1440, but the three tiles still go three across from `sm` (640). **Not caused by the chart row** (the new "Last 14 days" row is one line at every width measured: 1440, 1366, 1280, 1024, 800, 768, 700, 640, 390, 375).

**Fixed** - the owner chose the cheapest fix, in release 14 (D27-369): three across from `md` (768) instead of `sm`, the phone layout (one card of blocks) up to 767 (`Dashboard.tsx`, the figures block only). Measured in the browser pane: 640 and 700 wide, one card, rows as on a 375 phone; 768 and 1024, three across (226 and 229 px), every so-far row one line (21 px). Manual A1 says so.

### REP-19 · The Dashboard read every booking ever made three times to count today's - FIXED 14 October (D27-316 (1))

**Found** - with front desk's FD-31: its one-day board read every booking twice
(front desk's `getStayView`) and today's work read it again (`fetchStays(code)`)
to count today's arrivals and departures - 793 rows each, ~12 s for the three
on a loaded PC. **Fixed** - both read the day's board (`board=1`), 32 rows,
0.4-0.6 s; the figures compared equal with every booking's on four days of the
13 October copy. The query key now carries the date it counts.
**The rule:** a tile about today reads today.

### REP-17 · Another property's page read its figures for the SELECTED property's day - FIXED 12 October (D27-308 (1a))

**Found** - the A16 video check, by reading the code; confirmed on screen 12 October on a scratch copy of the demo: 5 Elements selected (business date 9 October), Hotel Majestic Grand's page (its own date 12 October, one of its four rooms booked that night) asked `/statistics/snapshot?date=2026-10-09` and `/statistics/period?from=2026-10-01&to=2026-10-09`, and showed "Rooms sold today 0", "Occupancy 0%". `getTodaySnapshot` and `getPeriodStatistics` defaulted to the seam's `BUSINESS_DATE`/`PTD_FROM`/`PTD_TO`, which follow the property chosen at the top; the property page passed no date, believing the server's default would apply.

**Done** - `data/statistics.ts`: both send no date unless given one, so the route uses the property's own business date and month. After: the same page asked `/statistics/snapshot` and `/statistics/period` and showed 1 sold, 25%, ₹5,000 month to date.

**Proved** - `src/modules/admin/propertiesD27308.test.tsx` "asks for that property's own day" failed first (`?date=2026-08-25` asked) and passes.

**The rule** - a default that reads the seam's date is the SELECTED property's date. A call about another property sends its own date or none.

### REP-18 · Month RevPAR ₹559 in All properties' panel and ₹560 in the property's row - FIXED 12 October (D27-308 (1c))

**Found** - the A16 video check. `/statistics/period` rounded `adr` and `revpar` to the paisa (`ratio()`), and the screens then rounded to the rupee: 559.497 → 559.50 → ₹560 in the row, while the panel worked from the totals and printed ₹559.

**Done** - `api/src/modules/reports/statistics.ts`: the period's rates come back exact (`room / sold`, `room / available`); every screen rounds once, when it prints.

**Proved** - `api/test/modules/reports/periodRates.test.ts` failed against the old route ("expected 3884.54 to be 3884.5426114649676") and passes against the new.

**The rule** - round once, where the figure is printed.

### REP-16 · Between 1280 and 1439 wide the Dashboard's three figure tiles broke "Month so far" and "Year so far" onto two lines - FIXED 3 October

**Found** - 30 September, measuring the Dashboard-charts render against the running app (numbered for now by that work). At 1280 wide each tile was 178px: "Month so far ₹4,17,293" and "Year so far ₹57,10,112" did not fit beside their labels, the rows measured 42px against 21px, and the three amounts sat at different heights (the Level Rule). The same at 1366; at 1440 they fitted with about 4px to spare.

**Done** (the owner's D27-243) - under 1440 px Occupancy takes its own row and the three figures the full width (`min-[1440px]:col-span-5` / `col-span-7` in `pages/Dashboard.tsx`, was `xl:` = 1280).

**Proved** - measured in the browser pane on the local demo, 3 October: at 1280 each tile is 314px and at 1366 343px, Occupancy on its own row; at 1440, 211px beside Occupancy. At all three every "so far" row is 21px (one line) and the three amounts share one top. Screenshots `.local\screenshots\2026-10-02-dashboard-build\`.

**Confirmed as the owner's answer** - the chart row's brief (D27-365 (7), 26 October) asked for exactly this layout, so nothing more was needed. Measured again with "Last 14 days" added to each tile: at 1440 Occupancy beside the tiles (462px), at 1366 and 1280 on its own row (1052px, 966px); every "Last 14 days", "Month so far" and "Year so far" row at one top, none wrapped.

### REP-15 · The Dashboard put a <div> inside a <p> on every load - FIXED 30 September (by the booking and bill lane; numbered for now)

The occupancy and figure tiles wrapped `fig()` in `<p>`; while loading `fig()` is the Skeleton, a `<div>`, and React logged the nesting. **Fixed:** both wrappers are `<div>`. The test formats React's `%s` message - matching the raw call missed it and passed on the broken code first.

### REP-14 · The Cashier shift showed Reception's cash as "not on record" to the Accountant (QA RP-4) — FIXED 28 September

**Found** — the QA of 28 September (RP-4). The report joined `staff` for the name, and `staff` shows a clerk only their own row and their colleagues through `staff_hotels`, which since 149 shows each person only their own roster line. So only the owner and the cashier themselves saw a name.

**Done** — `reports.ts` reads the name through `app.hotel_people` (149, names and roles only, D27-96), keeping `staff` for the group administrator who is on no roster.

**Proved** — `reports.test.ts` "names the clerk who took the money to the Accountant (QA RP-4)" failed with the old join ("expected null to be 'RPTEST clerk'"). On screen as Test Accountant: "Test Reception · UPI · 1 · ₹10".

**The rule** — A name read from `staff` is only as wide as the reader's own row; a colleague's name comes through `app.hotel_people`.

### REP-13 · The Lodging tax heading read a rate nobody can set — FIXED 24 September

**Found** — 23 September, while taking the 2.5% default off
`hotels.cgst_rate`/`sgst_rate` (finance's FIN-5, D22-9). The sheet's "CGST
@2.5%" heading is the only report reading that pair, which 067 superseded:
what a posting carries is `tax_rules`, and no screen writes the pair. So a
hotel made from now on heads its sheet "CGST @-" for good, and 5 Elements'
"@2.5%" says nothing about a room billed at 18% above ₹7,500.

**Not changed** — which rate a filed sheet's heading should name is the
owner's and the accountant's (the sheet is theirs, D17-99). The question is
with the master: the room rule from `tax_rules` (one heading per slab, or
none when there are two), or the rate the bills of that month carried.

**Fixed** — the owner's D24-23: no rate in the heading, "CGST" and "SGST";
the amounts unchanged. `builders/lodgingTax.ts` names none, and the
property's `cgstRate`/`sgstRate`, read by nothing else, left `figures.ts`.

**Proved** — `api/test/modules/reports/reports.test.ts` and
`lodgingTaxAlcohol.test.ts` read the group "CGST"; both fail with "CGST @2.5%"
put back.

### REP-12 · Lodging tax's Other Bills carried alcohol and its VAT — FIXED 24 September

**Found** — the owner's D22-45, 22 September ("take alcohol and its VAT
out"). The sheet's bill numbers and Total Bill come from the GST invoice,
which carries no alcohol (D21-91); Other Bills summed every non-room line on
the folio, the VAT line and its VAT included.

**Fixed** — `builders/lodgingTax.ts` reads the bill's GST lines only
(`tax_scheme = 'gst'`), so no column of the sheet carries alcohol. The
footnote says so.

**Proved** — `api/test/modules/reports/lodgingTaxAlcohol.test.ts`: a bill with
a room (₹2,000 + 5%), a dinner (₹1,000 + 5%) and a whisky (₹500 + 10% VAT)
reads Other Bills ₹1,050, not ₹1,600; it fails with the filter taken out
(24 September). On screen (`fidato_s1`, August 2026): room 202's bill of a
room and ₹550 of whisky with its VAT reads Other Bills ₹0.00 (with a laundry
line added, ₹126.00 - the laundry and its GST, never the whisky)
(`.local/screenshots/2026-09-24-finance/11-…`).

**The rule** — a sheet read from GST invoices reads GST lines.

### REP-11 · A booking nobody has arrived on appears in the Night audit's Room Charges

**Found** — 17 September 2026, reading the finished report against the demo:
Lata Bhosale, booked for 25–27 August and still `confirmed`, is listed with a
room charge of ₹2,857 for the night of the 25th.

It follows from the owner's decision of 17 September (D17-71): a night not posted
yet, from the business date on, counts at the booking's rate — which is what
makes tonight's rent readable before the audit posts it, and what puts the nights
booked ahead on Monthly statistics. On a day the audit has CLOSED the question
does not arise: the audit marks an arrival that never came as a no-show, and it
leaves the section. So the row only appears on a day still open, and the report's
own footnote says the rule.

**ANSWERED: leave it (D17-94, 18 September).** The owner's words through the
master: it agrees with the Manager report, the footnote says the rule, and it
goes when the audit marks the no-show. Recorded here so the next person does not
"correct" it.

**The rule** — A report of a day that is not over yet is a forecast in places.
Say which places, on the report.

### REP-6 · "Owed by guests" on the Dashboard is a net figure under a gross label

**Found** — 16 September 2026, design critique; measured on screen the same day in the reports lane's own database.

The Dashboard's tile reads the Manager report's Guest ledger closing balance. Folios shows the same figure as **Net position**, "Owed to the property, less refunds": on the lane's demo data Outstanding ₹63,440 − Overpaid ₹784 = ₹62,656, and the tile says "Owed by guests ₹62,656 — Every guest bill still open". Guests owe ₹63,440; ₹784 is owed back to one of them. The label is a money claim.

**ANSWERED, and built.** The owner chose "Owed by guests, less refunds" (D17-17, 17 September); the master changed the tile and the `guestLedger` line in `src/lib/glossary.ts` together. Since 17 September that figure also leaves out deposits still waiting for a guest who has not arrived.

**The rule** — A label on a figure is a claim about what the figure counts. Read the query before the word.

---

### REP-8 · MINE: the reports tests left ₹2,734.50 in the demo property

**Found** — 17 September 2026, by the MASTER, running the whole API suite; my own
file was green on its own. **Fixed** the same day.

Three checks of the reports in the owner's layout need money the demo does not
hold — a bill transferred to a company, a deposit taken before arrival — and
they posted it and walked away. `api/test/businessDate.test.ts` then read
₹3,99,776.43 where the demo is calibrated to ₹3,97,041.93, the figure reconciled
to the owner's real eZee export to the paisa. The file passed; the suite failed.

**What was done** — every payment these tests post is recorded and REVERSED in
`afterAll` (the reverse route: `folio_postings` is append-only and the trigger
fires for the superuser too), and the teardown then MEASURES that the property's
payment postings are back where they were. What cannot be undone — a settled
restaurant bill, an invoice, both evidence by design — is counted before and
after instead, with a sentence saying why.

**Proved** — `npm test -- test/modules/reports test/businessDate` 34/34 together;
with the reversal loop removed the teardown fails with "these tests left money in
the demo property".

**The rule** — A test that writes into the demo property owns putting it back,
and a cleanup nobody measures is a cleanup nobody has. Run the SUITE, not the
file: a fixture's damage shows up in somebody else's test.

### REP-9 · A bill transferred to the city ledger counted as money received

**Found** — 17 September 2026, building the City ledger report, by posting one
transfer in the lane's database and watching the day's Receipt column move.
**Fixed** the same day.

"Bill to company" is posted as a payment on the folio — the balance does move —
but nobody has handed over any money. It was counted in Monthly statistics'
Receipt, in the Manager report's Total Payment, and in the cashier shift, which
is a drawer that will not balance.

**What was done** — money received excludes payments whose method is
`city_ledger`, in `figures.ts` (one place, every report) and in the cashier
shift. The transfer is the City ledger's Debit, and the Manager report's Charges
Raised, which is what the owner decided on 17 September (D17-74).

**The rule** — A posting's category says what it moved, not what happened. Ask
what the money did.

### REP-10 · A "Total" label in a date column printed as a dash

**Found** — 17 September 2026, by ReportView's own new test, on its first run.
**Fixed** the same day.

Every report's first column can hold words as well as dates: "Total", "Grand
Total", "1 Sat". The renderer sent the whole column through the date formatter,
which answers with the no-date mark for anything that is not a date — so the
total row of the Lodging tax sheet was labelled "-".

**What was done** — a date cell that is not a calendar date prints as the words
it is.

**The rule** — A column's kind describes most of its cells, not all of them. The
total row is the exception in every report ever printed.

### REP-1 · Monthly occupancy and Monthly statistics always showed August 2026

**Found** — 15 September, writing the service's brief, by reading. **Fixed** — 16 September, branch `reports/typed-dates`.

`pages/Statistics.tsx` asked for `getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31")` on both monthly pages and printed "August 2026"; Yearly statistics asked for 2026. Deeper than first written: `data/reportData.ts` defaulted `getMonthlyStatistics` to the same August, `getYearlyStatistics` to 2026, and No show, City ledger and Lodging tax to a `from` of "2026-08-01"; and the server's yearly endpoint answered `?? 2026` when no year was sent.

**What was done** — `monthOf(date)` in `data/statistics.ts` gives the month's first and last day and its name; the three pages call it with the business date, and put the month in the query key so a property switch refetches. The monthly and yearly data calls take their range with no default; the three ledger defaults are `PTD_FROM`. The server's yearly endpoint takes the property's business date when no year is sent. The owner was not asked about a month chooser, so none was added: the pages show the business date's month, as the server already did when asked for no range.

**Proved** — `data/statistics.test.ts` (February in a leap year and not, December, January) failed with August put back in `monthOf`. `api/test/modules/reports/reports.test.ts` moves 5EL's business date to 10 May 2027 and reads the yearly grid as 2027; it failed with `?? 2026` put back. On screen at business dates 10 May 2027 and 10 February 2027: "May 2027", "February 2027" (1–28 Feb), "Year 2027".

**The rule** — A date typed into a screen is a date that stops being true.

### REP-2 · The Manager report's year started on 1 April 2026, typed in

**Found** — 15 September, writing the brief, by reading `manager.ts`. **Fixed** — 16 September, branch `reports/typed-dates`.

`const FY_START = "2026-04-01"` in `api/src/modules/reports/manager.ts` fed every YTD column. Correct until 31 March 2027, wrong from April 2027 — quietly. A second copy, `export const FY_START` in `data/managerReport.ts`, was read by nothing.

**What was done** — `financialYearStart(asOn)` on the server: 1 April of the report's own year from April, of the year before in January to March — the April rule of `app.current_fin_year()` (017), which could not be reused because it reads the wall clock. The web copy was removed, not corrected: the web has always taken `ytdFrom` from the server.

**Proved** — the API test asks for reports as on 25 Aug 2026, 10 Feb 2027, 31 Mar 2027, 1 Apr 2027, 10 May 2027 and 15 Jan 2028, and checks the YTD room-nights against the database's own sum over the window the label names — as on 10 May 2027 that is 680; with the literal put back it was 6,891 and the test failed. On screen as on 10 February 2027 the YTD column carried August 2026's ₹4,19,579 of room charges under "YTD from 1 Apr 2026".

**The rule** — A literal date is a bomb with a date on it.

### REP-3 · All reports opened a screen headed "Reports"

**Found** — 15 September, writing the brief; confirmed on screen 16 September in the route audit. **Fixed** — 16 September.

**What was done** — `pages/Index.tsx` is headed "All reports"; the browser tab follows (`PageHeader` sets it). Seen on screen: menu entry, heading and tab all read "All reports".

**The rule** — A screen's heading is the menu entry that opened it, or somebody has to check.

### REP-4 · A Manager report as on an earlier month ran its PTD from the business date's month

**Found** — 16 September, writing REP-2's test, by reading. **Fixed** the same day.

The server defaulted `ptdFrom` to `monthStart(businessDate)` rather than the report's own `asOn`. Asked for a report as on 10 February 2027 with no period, it ran PTD from 1 August 2026. Nobody saw it because the web always sends `ptdFrom`. Now `monthStart(asOn)` — identical whenever `asOn` is not sent. The API test failed with the old line put back ("period start for 2027-02-10: expected '2026-08-01'").

**The rule** — A default derived from one date belongs to the date the caller asked about, not the one the server happens to know.

### REP-5 · The STATISTICS block printed `3952.80` beside the Dashboard's `₹3,953`

**Found** — 16 September, design critique. **Fixed** the same day.

Every row of the Manager report's Statistics block went through one local count formatter — no ₹, no grouping, two decimals.

**What was done** — the server marks each Statistics row with its `unit` (`money` or `percent`); the page prints them through `money()` and `percent(n, 2)` from `src/lib/format.ts`. On screen as on 25 Aug 2026 the block reads what the Dashboard tiles read: 29.41% · 30.63% · 5.27%, ₹5,505 · ₹3,179 · ₹3,179, ₹1,619 · ₹974 · ₹168. The API test that pins the units failed with them removed. The report's footer stamp is labelled "Printed" in the same change.

**The rule** — A figure is formatted by what it is, and the row that knows what it is says so.

### REP-7 · MINE: a deliberate break that never applied, in a run that looked complete

**Found** — 16 September, proving REP-1's server guard.

Four breaks ran in one script. The third was a Python replacement that asserted its old text was present; the file has CRLF endings and the text did not match, so the assertion stopped that step and the script went on to the fourth. Its summary showed three failing runs and no line for the third at all. Caught by counting the "BREAK" headings, re-run with line endings normalised, and seen to fail.

**The rule** — A proof that disables a guard reports that the break applied, not only what the tests said. Count the breaks that ran.

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **6** · Three defects the ledger hid until new screens read it — Rule: a fixture is only as honest as the screens that have read it. Expect each new screen to find something, and fix the seed rather than the screen.
- **40** · A boolean where a document should have been
- **43** · A revenue total that ignored every discount
- **44** · A GST register dated by the wall clock
- **135** · Four reports built, listed, and unreachable
- **147** · A date typed once, on the screen an owner opens first
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **253** · The Manager Report's period started on 1 August, whatever the month
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.
- **266** · The City ledger invented a contact person for every account — since 28 August — The rule: "never invent" covers words as well as numbers. A placeholder that looks like data is data to whoever reads it.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
