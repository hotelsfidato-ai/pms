# Accounting export

**The hotel's month, handed to its accountant.** A date range, a format, a
file. Built 19 September 2026 (D18-16, `docs/BUILD-PLAN-2026-09-18.md` § 7).
Until that day this folder held a Coming soon page and nothing else.

**It is not a ledger.** No chart of accounts, no posting back into Tally, no
payroll, nothing with a bank in it. It reads, adds up what it read, and hands
it over. The one thing it holds is the name of each ledger in the hotel's own
Tally, typed by the Accountant (below).

```
src/modules/accounting/          the screen, its menu entry and its address
api/src/modules/accounting/      the day book, the ledger names, and their routes
db/tests/modules/accounting.sql  the ledger names' database half
```

---

## The one rule that defines this service

**THE EXPORT AND THE REPORTS CAN NEVER DISAGREE.**

Every figure in the file is the figure the reports already print, read through
the reports service's front door - `dailyFigures`, `dailyExtras`, `sumDays`,
`propertyFor` and `heading` from `api/src/modules/reports/index.ts`. **There is no query
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
| Food charged to a room | Food on a bill, from the reports door's `dailyExtras` (ACC-3, D27-382): the desk's food charges and a restaurant bill charged to a room or a function. Not alcohol |
| Other extras | The rest of `.extra`: laundry, the spa, drinks that are not alcohol, late check-out and so on. **Food + Other extras = `.extra`, to the paisa**: `dayBook.test.ts` holds it on the calibrated month |
| Extra tax | `.extraTax` |
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

## The ledger names (D27-382)

The owner: *"a small page per hotel where the Accountant types each ledger name
exactly as in their Tally; the export stays off until all are filled; no name
is ever invented."* A card on the Accounting export screen, with
`GET` and `PUT /:code/accounting/tally-ledgers` (`ledgers.ts`).

**No default name, ever.** A ledger nobody has named has no row in
`tally_ledger_names` and reads as null. The labels on the form are this
system's words for what a ledger is for and never reach a voucher. A name is
trimmed at the two ends and otherwise kept as typed. Sending a blank removes it.

**Who:** read and changed by whoever may export: the Accountant, the GM, the
owner and an Admin (`MAY_EXPORT`). `roleGate.ts` says `own` for both routes, so
the route's own check is the only one: `ledgers.test.ts` walks every other role.

**A setup record:** the full reset leaves it and a test hotel takes a copy
(`app.test_hotel_classes()`), with row security forced and every change in the
audit trail. `db/tests/modules/accounting.sql` holds all of that.

**Which ledgers a hotel is asked for** follows how it is set up (`ledgerNames`):

| Ledger | Asked for |
|---|---|
| Room rent, Food charged to a room, Other services | always |
| CGST, SGST | always; no IGST, a hotel's supply is always intra-state (`finance/invoices.ts`) |
| Discount given, What guests owe, What companies owe | always |
| Restaurant sales, Round off | where the `pos` module is on |
| Alcohol sales, VAT on alcohol | where the hotel serves alcohol, the `alcohol` module (D21-91) |
| Owner's allowance | where the allowance is set |
| Each way of paying | what the hotel offers or has taken, cash, card and UPI where it has a restaurant, and how a company pays (bank transfer, cheque, UPI, card) |

---

## The three formats (D18-16)

All three are offered on the screen; whoever exports picks what their
accountant asks for.

| Format | State |
|---|---|
| **Day book (CSV)** | **Built.** `src/lib/csv.ts` writes it in the browser - BOM, CRLF, quoting and the leading `=` a spreadsheet would execute are all already solved there. |
| **Day book (Excel)** | **Built** (D22-37, "both the CSV and a real .xlsx"; its own choice in the list, the owner, 24 September). Made on the server, `GET /:code/accounting/day-book.xlsx` (exceljs). Both files are laid out by ONE function, `dayBookSheet` in `api/src/modules/accounting/sheet.ts`, which the screen imports as it imports `api/src/permissions.ts` - so the two cannot have different columns or figures. `dayBook.test.ts` reads the workbook back and compares it cell for cell with the CSV's rows. |
| **Tally Prime (XML)** | **Built, and imported into a real TallyPrime 7.2** (below). Off until every ledger name is typed. |
| **Tally ERP 9 (XML)** | **Built; its shape is tested, nothing more.** Only TallyPrime is installed here. |

---

## The Tally files (ACC-4, D18-16, D27-382)

`GET /:code/accounting/tally-prime.xml` and `tally-erp9.xml`, built on the
server in `tally.ts`, refused the same way as the day book (`exported` in
`routes.ts`), plus: a blank ledger name, a day not closed, a day that cannot
balance, a payment with no way of paying on record. Each refusal is a 409 with a
sentence, and the screen shows it.

**One voucher a day, not one per bill.** The day book counts the ledger by day
and the bills are another basis (ACC-6), so only a day's voucher is the day
book's own figures. A voucher per bill would need a ledger per guest. Each
company receipt is its own voucher: it has its own party and reference.

| Case | Voucher |
|---|---|
| The day's sales, GST, VAT, discount | One **Sales** voucher. Credit: Room rent, Food, Other services, Restaurant sales, Alcohol sales, CGST, SGST, VAT. Debit: Discount given |
| Charges on bills | Sales voucher, debit What guests owe |
| What the outlets took | Sales voucher, debit Cash, Card, UPI, by tender |
| A rounded bill | Sales voucher, Round off |
| The owner's allowance, its free part (D27-366) | Sales voucher, debit Owner's allowance |
| Paid on bills | One **Receipt** voucher a day: debit each way of paying, credit What guests owe |
| A refund | One **Payment** voucher a day: debit What guests owe, credit the way it went back |
| A bill to a company | One **Journal** voucher a day: debit What companies owe, credit What guests owe |
| A company's payment | A **Receipt** voucher of its own: debit the way of paying, credit What companies owe |
| A reversal, a struck line, an NC bill, a voided bill | None: the day book does not count them. A paid bill is voided only on its own business day, so that cannot change a closed day |
| A credit note, a cancelled VAT bill | None: neither touches the ledger the day book counts. **Listed for the owner** |
| Supplier dues, cash expenses, cash banked | None: not in the day book. **Listed for the owner** |

No IGST: this system never issues it. CGST and SGST are the day's GST halved as
the Manager report halves it, so they can differ from the bills' own CGST and
SGST by a paisa. VAT is never split (D21-91).

**The checks in `tally.ts` are real.** The Guests line comes from the day's sales
less the outlets', and the tenders from the outlets' own records, so a day where
a bill has no tender, or the extras do not add up, does not balance and is
refused. Tally itself answers a voucher that does not balance with `EXCEPTIONS 1`
and no reason at all, which is why the sentence has to be made here.

**What a real TallyPrime did** (7.2, Educational Mode, company `FidatoPractice`,
31 October, over its XML port, demo data):

- A voucher naming a ledger that does not exist: `LINEERROR Ledger '...' does not
  exist!`, `CREATED 0`, `EXCEPTIONS 1`, **`ERRORS 0`**. No ledger was created. So
  `ERRORS 0` proves nothing: read `CREATED` and `EXCEPTIONS`.
- **One wrong name in a file of five: `CREATED 4`, `EXCEPTIONS 1`.** Tally takes
  the rest, so the day is part-way in. Put right and sent again: `ALTERED 5`,
  nothing doubled. The refused voucher is held, outside the books, until then.
- The real export, one day, five vouchers: `CREATED 5`, no exceptions, Tally's Day
  Book debit and credit 14,157.33, every figure equal to the day book's.
- A corrected day sent again: `ALTERED 4`, replaced, not doubled. The `REMOTEID`
  survived a restart of Tally. A voucher the day no longer has stays (ACC-12).
- Tally ignores `VOUCHERNUMBER` under its automatic numbering, so the reference is
  in the narration too.
- Educational Mode takes the 1st, 2nd and 31st only, and answers any other date
  with "Voucher date is missing". No product code knows this.

**Not proved:** Tally ERP 9 at all (Prime did accept that shape, which says
nothing about ERP 9); the file through Alt+O rather than the XML port, and
whether its overwrite setting then replaces a voucher; a licensed copy; Tally's
GST reports. **The first real proof is the Accountant importing one day into a
copy of the company in Tally.**

`tally-ledgers` and the two files are all `own` in `roleGate.ts`: `MAY_EXPORT`
is the only check, so a test holds each.

---

## Requests

Things this service needs from files it may not edit. Each is a line, not an
edit made here.

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
accounts, reading anything back from Tally, payroll, anything with a bank in it.

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
