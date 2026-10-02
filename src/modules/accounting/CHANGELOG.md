# Changelog — accounting export

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-02 · What companies paid, as receipts apart from sales (the owner's D27-239, Q4) - the cash lane's

**Asked for:** the master, with the owner's answer: company and booking-site
payments in the day book as receipts, kept apart from the day's sales, with a
clear place for the Tally export.
**Shipped:** each day gets "Received from companies" (finance's
`companyReceipts`, through its front door - live lines only, a reversed
payment and its reversal both out); the CSV and the .xlsx gain the column
before "Night audit", and the .xlsx a second sheet "Received from companies"
(date, who, how, reference, amount) - a receipt voucher's shape. The page
shows the tile "Received from companies · Apart from sales" and the list.
**Proved:** finance's `companyPayments.test.ts` (the day book's figure and
list, and after a reversal); `test/modules/accounting` 97 tests with roleGate
and resetOrder, passed; web `accounting.test.tsx` passed. Screen as the
Accountant: ₹1,000.00 from Expedia, bank transfer, UTR 4471209; 375 px, no
sideways scroll.
**Left open:** the Tally XML formats are still ACC-4.

---

## 2026-09-29 · A range holding a night with no room GST rate is refused (D27-173) - the leads lane's

**Asked for:** the master: a Tally export never carries a null or a guessed
tax. Since the reports' `NIGHTS` gives a night not charged yet, at a property
with no room GST rate, an unknown tax (the reports' entry the same day), the
day book could meet a null.
**Shipped:** `dayBook()` checks the figures first and throws `NoRoomRate` before
building anything; the route answers 409 "A night in this range is not charged
yet and rooms have no GST rate. Set it on Room types, or end the range before
today." Only a range reaching the business date or later can meet it.
**Proved:** `dayBook.test.ts`, the last case: a new property with no room rule
and a future booking is refused with that sentence; a range ending the day
before builds. Run results: the leads lane's CHANGELOG.
**Left open:** nothing here.

---

## 2026-09-24 · the day book as a real Excel file (D22-37), and ACC-11

**Asked for:** the owner's D22-37 - "both the CSV and a real .xlsx", same
columns and figures, with `exceljs` (already in `api/package.json`), tested
by reading the .xlsx back. Started by a helper on 23 September
(`finance/rule-breakers-xlsx`, stopped mid-task) and finished here.

**Shipped:**
- `GET /:code/accounting/day-book.xlsx` - the same route as the day book, so
  the same refusals; the file named as the CSV is.
- `api/src/modules/accounting/sheet.ts` - `dayBookSheet`, the one layout
  both files are written from. The helper had copied the header row and the
  figures into the server and read the website's source with a regular
  expression to check they matched; the website now imports the server's
  function instead (as `src/lib/permissions.ts` does), and the copy and the
  regex are gone.
- "Day book (Excel)" is its own choice in the Format list; Export hands over
  the one chosen (the owner, 24 September - the helper's one button, two
  files would have made the browser ask about several downloads).
- ACC-11 (DEFECTS.md): a restaurant bill charged to a room was counted twice;
  fixed with the owner's yes.

**Proved:**
- API `dayBook.test.ts`: the workbook read back with exceljs equals the
  CSV's rows cell for cell (fails with the total row dropped); reception is
  refused the .xlsx as the day book; a room-charged meal counts once (fails
  with the fix taken out).
- Web `accounting.test.tsx` (15): Excel chosen downloads the .xlsx and no
  CSV, the CSV otherwise (fails with the choice ignored).
- On screen, `fidato_s1`, as the Owner: both files downloaded through the
  page (`.local/screenshots/2026-09-24-finance/export-files/`), 27 rows by 12
  columns each, 0 cells differing.

**Then ACC-10, the owner's D24-24:** "Restaurant" and "Restaurant tax" after
"Extra tax", in both files and on the screen's table, added once in
`sheet.ts`. Web `accounting.test.tsx` (16) fails with them taken out; the
API's cell-for-cell read-back carries them.

**Left open:** nothing of this session's.

---

## 2026-09-19 · the Tally export, first version: a day book that cannot disagree with the reports

**Asked for:** D18-16 and `docs/BUILD-PLAN-2026-09-18.md` § 7 — one screen, a
date range, three formats to choose from, and figures that are the ones the
reports already print. The brief: `docs/briefs/accounting.md`.

**Shipped**

- **The day book, on the server** — `api/src/modules/accounting/dayBook.ts`.
  Room revenue, room tax, extra charges, extra tax, discount, sales, tax and
  receipts, **by day for any range**, plus whether the night audit has closed
  each day. Every figure comes through the reports service's front door
  (`dailyFigures`, `sumDays`, `propertyFor`, `heading`). **There is no query
  over `folio_postings` in this service.**
- **One route** — `GET /:code/accounting/day-book?from=&to=`, in
  `api/src/modules/accounting/routes.ts`, mounted through this service's own
  front door. `api/src/server.ts` was not touched.
- **The screen** — `src/modules/accounting/pages/Accounting.tsx`, replacing
  the Coming soon page. A range with both ends included (said out loud, since
  every other range here is half-open), the three formats, the day book drawn,
  the totals, and the days the audit has not closed named above the table.
- **The seam and the file** — `src/modules/accounting/data/accounting.ts`.
  The screen draws the object and the CSV is written from **the same object**,
  so the figures a person checks and the figures their accountant opens cannot
  be two code paths that drift. The file itself is `src/lib/csv.ts`, which
  already solves the BOM, CRLF, quoting and the leading `=` a spreadsheet would
  execute.
- **It left the Coming soon section** — `nav.ts` moved to **Reports**, order
  140, `listed: false`; `routes.tsx` from `/coming-soon/accounting` to
  `/reports/accounting`. `src/components/app/navigation.test.ts`'s `SOON` list
  lost "Accounting export", exactly as it lost "Purchasing" on 18 September —
  **the master's file, one line, edited by this chat for the master to review
  at merge**, which is what the comment above that list asks for.
- **Who may export** — the owner, an administrator and the GM. **No new
  resource was invented**: `report` is the resource, `canSee` narrows the menu
  to the three, and the route refuses the hotel manager, the revenue manager
  and finance at the server, all three of whom hold `report`.

**Decided by the owner this session** (asked with a recommendation, and
waited):

- **The two Tally XML formats produce no file yet.** They need the ledger
  names in the owner's own books; a name invented here is *created* inside
  their Tally on import. All three are still offered, as D18-16 requires, and
  the two say exactly what they wait for. (ACC-4)
- **Extras are one line for now**, not split into Food and the rest, because
  that split is not exported from the reports door. (ACC-3)
- **The screen says which basis it counts**, because the Lodging tax report
  counts the bills that were issued and this counts the ledger by day, and the
  two do not tie out for a stay still in house. (ACC-6)

**Found**

- **ACC-1** — the new menu entry took `order: 80` in Reports, where Yearly
  statistics already sits. Caught by `navigation.test.ts` on the full web run,
  not by reading. Moved to 140. The orders are tens **across every service**.
- **ACC-2** — the demo has **no completed night audit in the month at all**,
  so every assertion about the Closed column ran against `false`, and wiring
  the column to the constant `false` passed the whole file. A test now closes
  a day, reads it, unclosed it and **measures** that it went back.
- **ACC-8** — the screen carried an "Nothing in this range" empty state that
  **could never render**: `dailyFigures` left-joins onto `generate_series`, so
  it returns a row for every day whether anything happened or not. A month in
  which the hotel charged and received nothing would have shown twenty-five
  ordinary rows of `₹0.00` and handed over the file without a word. Found by
  re-reading my own screen, **with the whole suite green** — no test could
  reach it. Replaced with the sentence that can happen.
- **ACC-7 — and this one is every lane's, not just this one.**
  `npm run lane -- accounting` reported **"90 files changed · 38 outside the
  accounting lane"** and named laundry's, spa's, revenue management's and
  purchasing's files. This chat had touched **thirteen paths.**
  `scripts/lane.mjs` takes its baseline from `origin/cp6` first, and **the
  owner stopped every push on 19 September** — so `origin/cp6` is frozen at
  `079f074` while local `cp6` has moved to `b13d841`, 13 commits of
  already-merged work that never left this machine. Every lane from today on
  gets the same false report, and a real stray edit will arrive inside that
  noise and be waved through. **Not fixed here** — `scripts/` audits every
  chat and is not one chat's to change. The one-line fix and the reasoning are
  in `DEFECTS.md` ACC-7; **it belongs in the root `MEMORY.md`, which is the
  master's to number.**
- **ACC-3, ACC-4, ACC-5, ACC-6** — in `DEFECTS.md`, with what was done.

**Proved** — gate numbers actually run in this copy, on this machine. There is
no Action: the owner stopped every push on 19 September, so this run is the
whole of the proof.

| Gate | Result |
|---|---|
| `npx tsc -b --force` | **exit 0** |
| `npx vitest run` | **414 passed, 46 files · exit 0** (411 before this session) |
| `npx vitest run src/modules/accounting` | **13 passed** |
| `cd api; npm test` | **1139 passed, 72 files · exit 0**, 608.74s |
| `cd api; npm test -- modules/accounting` | **15 passed** |
| `bash db/tests/run.sh` | **all 938 assertions passed · exit 0** |
| `npm run build` | **exit 0**, and `✓ no test sign-in in dist (6 files checked)` |

⚠ **Two of these were red before they were green, and both reds were mine:**
the first full web run failed on `navigation.test.ts` (ACC-1) and the first
full API run failed on this service's own new test (ACC-9). Neither was found
by the short per-service gates the brief lists — **only the full suites found
them.** Worth knowing for the next chat that is tempted to quote the short
ones.

**And the screen was opened**, on this copy's own servers (vite 5202, API
8802, database `fidato_accounting`), signed in as the owner, at
`/reports/accounting`:

- The day book drew **25 rows, 1–25 August 2026**, every one marked **Not
  run**, above the sentence naming them.
- **25 August room revenue read `₹17,634.90`** on the screen. The **Manager
  report's own "Room Charges · Today"** for the same date, asked of the other
  service through its own route, answered **17634.9**. That is this service's
  one rule, checked live rather than only in a fixture.
- **Receipts for the range totalled `₹3,97,041.93`** — the figure
  `api/test/businessDate.test.ts` calibrates to the owner's real eZee export,
  to the paisa.
- Choosing **Tally Prime** greyed the Export button out, with the reason
  beside it.
- **Reception was refused at the API: 403**, "The accounting export is the
  owner's, an administrator's and the general manager's." A six-year range:
  **400**.

Both servers were stopped afterwards and both ports confirmed free. ⚠ The API
process's own command line names `D:\fidato pms\api\node_modules` — the shared
junction — so it had to be identified by its PARENT's command line before
being stopped. Killing on the child's line alone would have missed it, and
matching on the child's line loosely would have killed the master's.

**The guards, each one watched failing.** Five on the server were broken
together, since each has its own test, and five tests failed — **but one of
those five was not a refusal, and I did not notice until the full suite ran
(ACC-9). Four were proved in that run; the fifth was proved afterwards, on
its own.** Every break was put back and the file went green again.

| Broken | The test that refused it |
|---|---|
| `MAY_EXPORT` widened to include `front_desk` | "refuses reception, who holds `report` and is still not the three" — 200, expected 403 |
| the `to < from` check deleted | "refuses a last day that falls before the first" — 200, expected 400 |
| `LONGEST_DAYS` 366 → 100000 | "refuses a range longer than a year" — 200, expected 400 |
| `closed: closed.has(date)` → `closed: false` | "says Closed for a day the night audit HAS run" — **but see ACC-9: this one was not proved in that run.** It was erroring on its own insert, and I read the error as a refusal. Proved separately, afterwards: broken alone it now fails `AssertionError: expected false to be true`, and intact the file is **15 passed**. |
| `sales` stopped subtracting the discount | "sales are the room and the extras less the discount" — **4440981 paise against 4340981**, which is the ₹1,000 discount, the only one in the fixture |

Two on the web, the same way — both refused, both put back:

| Broken | The test that refused it |
|---|---|
| `canExport` stopped checking `blocked` | "will not offer a file it cannot write" |
| the nav entry put back in `coming-soon` | "sits in Reports now, and nowhere near Coming soon" — got `['Coming soon']` |

**Left open**

- **The extras split** (ACC-3) — waiting on the master for `dailyExtras()` out
  of `builders/manager.ts`. Wiring it in here is a few lines.
- **The two Tally XMLs** (ACC-4) — waiting on the owner's ledger names. They
  are built **on the server** when they come, not in the browser: escaping and
  the property's own date belong in the API suite, which runs in UTC.
- **`round2` and `roleAt`** (ACC-5) — two small copies that exist because the
  doors do not export them. Both raised in `MODULE.md` under Requests.
- **No migration was taken.** This service owns no table and needs no number.

**The lane check, read honestly** (ACC-7 — the tool's own number is wrong
while nothing is pushed): **13 paths. 12 are this service's own.** The
thirteenth is the master's `src/components/app/navigation.test.ts`, one line
of the `SOON` list, edited by that file's own written invitation and flagged
here for the master to review at merge.

**Commits:** see below.

---

## 2026-09-16 · its Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
Coming soon page for every service the system does not have, one section
for the owner, admins and general managers.

**Shipped:** `nav.ts` (one entry in the Coming soon section), `routes.tsx`
(`/coming-soon/accounting`, guarded), `pages/Accounting.tsx` (the shared Coming soon page
with this service's words); `index.ts` and `MODULE.md` say so. No server
code.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

**Left open:** everything the page lists under "What it needs before it can
be built".
