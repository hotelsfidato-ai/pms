# Where we are, and what is left to build

Paste everything below the line to the builder agent.

---

**Read this whole file before writing anything.** It is the audit of what
exists, what does not, and the order to build the rest in.

## Before you touch a single file

```bash
cd "D:\fidato pms" && git init && git add -A && git commit -m "CP0-CP5 complete"
```

There is **no version control in this project**. Two processes writing the same
folder destroyed a day's work tonight and it was unrecoverable. Commit before
each checkpoint from here on. This is not optional.

Working copies of every file that matters are staged in `docs/restore/`. If
something breaks, that is where it comes back from.

---

## Verified state

```
tsc -b     0 errors
tests      79 passed · 6 files
build      clean
library    13/15 byte-identical to the CRS
```

**Cleared and walked in a browser:**

| | |
|---|---|
| CP0 | toolchain, Tailwind, tokens |
| CP1 | design system — 32 primitives ported from the CRS |
| CP2 | every primitive on `/design-system`, three distinct list states |
| CP3 | shell, repository seam, demo data calibrated to the Manager Report |
| CP4 | **the tape chart** — 17 rooms × 14 days, no horizontal scroll |
| CP5 | **all five flows**, each walked end to end |

The five flows are not stubs. Check-in gates on clean rooms and captured ID.
The folio ledger is append-only — a reversal is its own line and the original
stays struck through. Check-out is **disabled with its reason** until the
balance reaches zero. A walk-in is one action and a below-rack rate demands a
reason. Housekeeping queues offline changes visibly and drains them on
reconnect.

---

## What is missing

**Four real screens exist. Thirty-four routes are placeholders.**

```
src/pages/
  Dashboard.tsx       group dashboard
  StayView.tsx        the tape chart
  Housekeeping.tsx    the mobile board
  DesignSystem.tsx    the living style guide
  Placeholder.tsx     serving 34 routes
```

Every placeholder already names what its screen will carry, and every one has a
route, a nav entry and a permission check. **You are filling in screens, not
wiring plumbing.**

### Group level — 18 routes

```
/properties                  the property list, read-only
/guests                      guest database, duplicates visible, merge action
/companies                   corporate accounts and city-ledger balances
/reports                     the report taxonomy, favouritable
/reports/manager             Today · PTD · YTD — revenue, payments, three ledgers
/reports/city-ledger         opening, debit, credit, closing per account
/reports/no-show             usually empty, and still prints
/reports/monthly-occupancy   occupancy % by day of month
/reports/monthly-stats       daily grid — available, sold, ADR, RevPAR, pax, tax
/reports/yearly-stats        the same grid by month, with grand total
/reports/lodging-tax         statutory Excel export, two-level CGST/SGST headers
/notifications               arrivals, overdue balances, failed syncs
/admin/properties            add a property — one form
/admin/users                 staff accounts and property access
/admin/roles                 the live permission matrix
/admin/audit-log             who changed what, append-only
/admin/integrations          channel manager and POS connection status
/admin/settings              tax rates, check-in times, invoice series
```

### Property level — 16 routes, all under `/h/:code/`

```
arrivals · arrivals/upcoming · in-house · in-house/due-out · walk-ins
reservations · folios · invoices · payments · city-ledger
room-types · rate-plans · rates · night-audit
cashiering · pos              ← unspecified, leave as placeholders
```

---

## Build in this order

### 1 · The three working lists — `arrivals`, `in-house`, `folios`

**Start here.** They are the screens a clerk opens most, the flows already
exist behind them, and every one is a `DataTable` over a repository function
that is already written:

```ts
listArrivals(hotelId, date)      listInHouse(hotelId, date)
listDepartures(hotelId, date)    listOpenFolios(hotelId)
```

Reuse the flow components rather than rebuilding them:

```
src/components/flows/CheckInFlow.tsx    drop it on an arrivals row
src/components/flows/FolioPanel.tsx     drop it on a folio row
src/components/flows/WalkInFlow.tsx     already opens from the tape chart
```

`in-house/due-out` and `arrivals/upcoming` are the same table with a different
filter. Do not write four table components — write one and pass it a filter.

### 2 · The eight reports

**`docs/REPORTS-SPEC.md` is the specification.** It was written from eight real
exports pulled from the live eZee system, and every column name, section heading
and formula in it is copied rather than invented. Follow it exactly.

The data is already there:

```ts
listDailyStatistics(hotelId, from, to)    getPeriodStatistics(hotelId, from, to)
getTodaySnapshot(hotelId, date)           getFolioPostings(hotelId, stayId)
```

Three things the spec insists on, which are easy to get wrong:

- **Negative numbers are normal.** The real exports carry `-784.00` (guest
  overpaid), `-11,485.07` (an OTA owes the hotel), `-217.93` discount,
  `-0.14` round-off. Never assume a money field is positive, never render a
  negative as blank, never wrap it in parentheses.
- **Zero rows and empty reports still print.** The real No Show report for
  25 August has no rows at all — just property, title and date. That is correct
  behaviour, not an `EmptyState` with a "create one" button.
- **The Lodging Tax report needs two-level headers** — `CGST @2.5%` spanning
  `Net Amt.` and `Tax Amt.`, and `SGST` the same. **`DataTable` cannot do this**,
  and it is a ported CRS file you must not widen. Build that one report as a
  bespoke table using the same tokens, the same `money()`, the same `tabular`.
  It should be indistinguishable in style and separate in code.

The ledger formulas are printed at the foot of the real Manager Report and
belong in `src/lib/rules.ts` (Rule 3), not inside a report component:

```
Guest Ledger Closing = Opening − Carry forwarded Advance Deposit
                       + Charge Posted − Settlement by Guest
Total Revenue        = PMS Revenue + POS Revenue
```

Every report exports. **Tax → Excel. Everything else → PDF.** That is what gets
filed and emailed today. `jspdf`, `xlsx` and `papaparse` already run in the CRS
— check those before adding a dependency.

### 3 · Admin — `roles`, `users`, `audit-log`, `settings`

`/admin/roles` is nearly free: `getMatrix()` returns the whole permission matrix
from `src/lib/permissions.ts`, which is already the single source the navigation
and every disabled button read from. Render it.

### 4 · The remainder

`guests`, `companies`, `properties`, `room-types`, `rate-plans`, `rates`,
`invoices`, `payments`, `city-ledger`, `night-audit`, `notifications`.

Leave `cashiering` and `pos` as placeholders. They are unspecified, and an
honest placeholder naming what a screen will carry is a correct answer — an
invented flow is not.

---

## Rules that have already caught real defects tonight

**Rule 2 — screens import only from `@/data/repositories`.** A test walks `src/`
and fails if anything outside `src/data` imports a fixture. Do not work around
it.

**Rule 5 — `hotelId` in every query key.** `queryKeys` in the seam index builds
them so a screen cannot forget. Use it.

**Rule 6 — a blocked action is shown disabled with its reason, never hidden.**
The rules live in `src/lib/rules.ts` and return `{ allowed, reason }`. The same
function that disables the button refuses the write.

**Rule 3 — business rules live only in `src/lib/rules.ts`.** A rule duplicated
in a component drifts, and the copy nobody remembers is the one that runs.

**Rule 8 — never claim unrun code works.** Three defects tonight passed `tsc`,
passed the tests, and were only caught by opening the page:

- Tailwind was entirely non-functional while every gate was green
- `/design-system` rendered a blank screen — a `Tooltip` with no provider
- a check-in ran, the toast fired, and **nothing on screen changed**, because
  the chart derived everything from dates instead of status

That last one is the lesson. *The visible update is what tells a clerk the work
landed.* If an action does not move a number on screen, it is not finished.

---

## What must not change

**`src/components/ui/` is ported from the CRS and runs in production.**
Thirteen of fifteen files are byte-identical. If a primitive genuinely does not
fit, that is a CRS bug too — report it and stop. Fixing it here and not there is
drift, found later by a stakeholder rather than a test.

Two real accessibility defects were found this way and are still open:

- **`Checkbox` and `Switch` have no accessible name.** Confirmed from the
  browser's accessibility tree. Radix renders `role="checkbox"` on a button, so
  the wrapping `<label>` never names it. Live in the CRS today.
- **Nothing uses `focus-visible:`.** All eight focus utilities sit on the five
  input components. `Button`, `Checkbox`, `Switch`, `Tabs` and `Pagination` have
  no focus styling at all.

---

## Still needing a human, not an agent

**Press Tab through `/h/:code/stay` and answer four questions:**

1. Is there a visible focus ring on **buttons**, or only on inputs?
2. Is it the brand ring or the browser's default blue?
3. Does `Escape` close the Dialog and the Drawer?
4. When a Drawer closes, does focus return to the button that opened it?

Focus *trap* is confirmed working — Radix guards are present and focus lands
inside the panel. Key handling and focus restoration are not measurable from a
script and remain unverified.

**Six of the seven properties have no confirmed name or room count.** Only
5 Elements Akkalkot is real: 17 rooms, Superior and Deluxe, CP and Room Only,
CGST 2.5 + SGST 2.5, POS outlet Sattva. The 175-room group total is
**unverified** and should not appear in any screen or document.

---

## Report format

For each screen you complete:

```
Screen           route and file
Reads            which repository functions — must be from @/data/repositories
Rules            which src/lib/rules.ts functions gate which controls
What I saw       what you observed in the browser, not what the commands printed
States           empty · loading · error — all three, with different words
Library touched  MUST be "none"
```

**Open every screen you build.** `tsc -b` has now failed to catch a blank page
three times.
