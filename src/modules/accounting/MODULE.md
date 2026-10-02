# Accounting export

**The hotel's month, handed to its accountant.** A date range, a format, a
file. Built 19 September 2026 (D18-16, `docs/BUILD-PLAN-2026-09-18.md` § 7).
Until that day this folder held a Coming soon page and nothing else.

**It is not a ledger.** No chart of accounts, no ledger names mapped per hotel,
no posting back into Tally, no payroll, nothing with a bank in it. It reads,
adds up what it read, and hands it over.

```
src/modules/accounting/          the screen, its menu entry and its address
api/src/modules/accounting/      the day book, and the one route that answers it
db/tests/modules/accounting.sql  does not exist - this service owns no table
```

---

## The one rule that defines this service

**THE EXPORT AND THE REPORTS CAN NEVER DISAGREE.**

Every figure in the file is the figure the reports already print, read through
the reports service's front door - `dailyFigures`, `sumDays`, `propertyFor`
and `heading` from `api/src/modules/reports/index.ts`. **There is no query
over `folio_postings` in this service and there must never be one.** A second
definition of "sales" is how the Dashboard and the Manager report came to
disagree about occupancy in August, and an accountant holding two different
sales figures for one month is worse off than one holding none.

`api/test/modules/accounting/dayBook.test.ts` holds that rule to the number:
a day's room revenue is asserted equal to the **Manager report's own "Room
Charges" for that day**, built by the other service through `buildReport`. If
somebody replaces the door with a query that looks equivalent, that test goes
red.

---

## Screens

| Menu name | Address | Page file | Who sees it |
|---|---|---|---|
| Accounting export | `/reports/accounting` | `pages/Accounting.tsx` | owner, admin, GM - the **Reports** section, `listed: false` |

It moved out of the Coming soon section the day it was built; a service that
is built cannot also be coming soon. Find a screen answers to "tally",
"accounts", "ledger", "export", "accountant", "day book" and "gst".

**Who may export:** the owner, an administrator and the general manager.
`report` is the resource - **no new one was invented**, because who may see a
screen is the owner's to widen and not a chat's. The hotel manager, the
revenue manager and finance all hold `report` and are still refused: `canSee`
narrows the menu and `api/src/modules/accounting/routes.ts` refuses them at
the server, because a hidden menu entry has never been a permission.

---

## What is in the file

One row a day, then a total, for the range chosen - **both ends included**,
which the screen says out loud because every other range in this system is
half-open.

| Column | Where it comes from |
|---|---|
| Room revenue, Room tax | `dailyFigures().room` / `.roomTax` |
| Extra charges, Extra tax | `.extra` / `.extraTax` - **one line, see Requests** |
| Discount | `.discount`, positive: the discount given |
| Sales | room + extras less the discount |
| Tax | room tax + extra tax |
| Receipts | `.receipt` - money received; a bill moved to the city ledger is not (D17-74) |
| Received from companies | what companies and booking sites paid against the City ledger that day, by the day it reached the hotel (D27-242, Q4) - **apart from Sales and from Receipts**: the bill was sales when it was sent. From finance's door (`companyReceipts`), live lines only (a reversed one is out) |
| Night audit | Closed, or **Not run** |

**Each company receipt is also listed** (date, received from, how, reference,
amount): under the tiles on the screen, and as the .xlsx's second sheet,
"Received from companies". It is the shape a Tally **receipt voucher** takes
(party, bank, amount, narration), so when the XML export is built (ACC-4, the
CA's ledger names) it reads this list - nothing new to derive.

**A period nobody has closed is still exported, and the screen says so**
(D18-16). A day the night audit has not run carries every figure it has and is
named - on the screen, and in its own column of the file. A day silently
printed as zero is the one an accountant files.

**A date is a string from end to end.** `dailyFigures` returns `YYYY-MM-DD`
out of Postgres and it stays text through the day book, the route, the seam
and the screen. **There is no `new Date()` anywhere in this service**: the
hotel's server runs in GMT (root MEMORY 297) and a JS date would move an
Akkalkot sale into the day before on the way past. The API suite runs in UTC,
so that fails here rather than in Akkalkot.

**The property's own details** - name, code, GSTIN - come from the property
record through the reports door, never a literal (root MEMORY 256).

---

## The three formats (D18-16)

All three are offered on the screen; whoever exports picks what their
accountant asks for.

| Format | State |
|---|---|
| **Day book (CSV)** | **Built.** `src/lib/csv.ts` writes it in the browser - BOM, CRLF, quoting and the leading `=` a spreadsheet would execute are all already solved there. |
| **Day book (Excel)** | **Built** (D22-37, "both the CSV and a real .xlsx"; its own choice in the list, the owner, 24 September). Made on the server, `GET /:code/accounting/day-book.xlsx` (exceljs). Both files are laid out by ONE function, `dayBookSheet` in `api/src/modules/accounting/sheet.ts`, which the screen imports as it imports `api/src/permissions.ts` - so the two cannot have different columns or figures. `dayBook.test.ts` reads the workbook back and compares it cell for cell with the CSV's rows. |
| **Tally Prime (XML)** | Offered, produces no file. **Waiting on the owner.** |
| **Tally ERP 9 (XML)** | Offered, produces no file. **Waiting on the owner.** |

**Why the two XMLs are not built** - the owner's answer, 19 September. A Tally
voucher has to name the ledger it posts to, and **the ledger names in the
owner's own books are the owner's to give**. A name invented here would be
*created* inside their Tally on import, and their accountant would spend an
evening merging ledgers this service made up. The screen says exactly that,
beside each one, rather than greying out a control with no reason next to it.

**When the names arrive**, the XML is built **on the server**, as its own
route beside the day book - not in the browser. Escaping (a property called
`Fidato & Co` must not break the file) and the property's own date belong in
the API suite, which runs in UTC. The day book is in the browser only because
`src/lib/csv.ts` already exists and is already trusted.

---

## Requests

Things this service needs from files it may not edit. Each is a line, not an
edit made here.

- **19 Sep, to the MASTER - the extras, split by kind.** The brief asks for
  room revenue, **food** and the other extras as separate lines, "because
  that is how they already appear on the Manager report". The reports door
  exports `dailyFigures`, whose `extra` is every non-room, non-money posting
  in one number; the split into Food / Beverage / Laundry / Spa / Minibar /
  Telephone / Late check-out / Early check-in / No-show retention /
  Miscellaneous is a query **inside** `managerReport` and is not exported.
  **Asked for: `dailyExtras(client, hotelId, from, to)` lifted out of
  `builders/manager.ts` into `figures.ts` and exported from
  `api/src/modules/reports/index.ts`** - exactly as R1 was opened for revenue
  management on 18 September, and for the same reason: one definition of every
  figure has to be reachable, or the second service writes its own.
  *The owner's answer, 19 September: ship one "Extra charges" line now and
  wire the split in when the door opens.* It is a few lines here.
- **19 Sep, to the MASTER - `round2`.** `api/src/modules/reports/document.ts`
  has it and the door does not export it, so `dayBook.ts` holds a one-line
  copy. Two definitions of how money rounds is the kind of thing this project
  hates; exporting it is one line in the door.
- **19 Sep, to the MASTER - `roleAt`.** `api/src/modules/accounting/routes.ts`
  now holds the **third** copy of the "what is this caller's role at this
  property" query (`equipment/grants.ts` and `housekeeping/repairRoles.ts`
  hold the other two). A service may not import another's insides, so a copy
  is the only way to ask it today. Hoisting it into `api/src/auth.ts` is the
  master's.
- **19 Sep, to the NIGHT AUDIT service (or the master) - is this day closed?**
  `dayBook.ts` reads `night_audit_runs` directly for the Closed / Not run
  column. It is a status, not a figure, so it does not break the rule at the
  top of this file - but if that service would rather own the answer, it is a
  door it can open and one line for this file to change.

## Requests from other services

None. Nothing here is exported: no other service reads the export, and this
one owns no figure of its own to lend. `api/src/modules/accounting/index.ts`
exports its mount and nothing else.

---

## Not in the first version

Purchase and supplier bills (finance's, and waiting on the owner), a chart of
accounts, ledger names mapped per hotel, posting back into Tally, payroll,
anything with a bank in it. **And a migration** - this service owns no table
and needs no number.

Whether "Excel" had to mean a real `.xlsx`: **the owner's D22-37, 22
September - both**, as two choices in the Format list (24 September). The
.xlsx is the server's (exceljs was already there for the reports' files); the
browser still carries no spreadsheet library.

---

## Gates

```powershell
npx tsc -b --force
npx vitest run src/modules/accounting src/test
cd api; npm test -- modules/accounting
```

`src/test/boundaries.test.ts` fails if this folder loses its `index.ts` or
this `MODULE.md`, or if anything here reaches past another service's front
door.
