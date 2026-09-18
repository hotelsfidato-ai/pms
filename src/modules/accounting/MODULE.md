# Accounting export

The day's money, exported for the hotel's accountant — or straight into
Tally.

**NOT BUILT. A Coming soon page only.** The owner chose on
16 September to give every service the system does not have a Coming soon
page, in one section at the foot of the menu for the owner, admins and
general managers. This folder holds this brief, an empty front door
(`index.ts`), its own `CHANGELOG.md` and `DEFECTS.md`, and the page with
its menu entry and address — no working feature, no server code.

**Folder name:** `accounting` — the word the other two places will use if it
is ever built:

```
src/modules/accounting/          this brief, and the Coming soon page (menu entry, address)
api/src/modules/accounting/      does not exist
db/tests/modules/accounting.sql  does not exist
```

---

## What it would be

Every closed day produces sales, tax, receipts and refunds that an
accountant has to enter again in the books. The reports print and export CSV,
but none of them speak to an accounting package (`PROGRESS.md`, "What a
market-leading HMS has that this does not", item 5: "Every Indian hotel of
this size runs Tally"). This service would hand the day over in a form the
accountant or Tally can take.

---

## Status, and where it comes from

- **Not built.** `docs/SERVICE-FOLDERS-PLAN.md`: "Accounting export |
  `accounting` | not built".
- **Decided and relevant:** e-invoicing is not required — the group is under
  ₹5 crore (`PROGRESS.md`, "What the owner has decided").
- **Open and relevant:** whether "Excel" means a real `.xlsx` or the CSV that
  Excel opens — `src/lib/csv.ts` avoids a spreadsheet library on purpose; do
  not add one unasked (`HANDOVER.md` § 3.4, reports in the owner's layout,
  ASK FIRST).

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Accounting export | `/coming-soon/accounting` | `pages/Accounting.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "tally", "accounts", "ledger", "export", "accountant". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. What your accountant uses: Tally, and which version.
2. The ledger names in your books.
3. Whether a CSV file is enough, or it must be an Excel workbook.

---

## What it would lean on

- **finance** — the folio postings, payments, invoices and credit notes.
- **night-audit** — it is what closes a hotel's day, and a person runs it
  (`HANDOVER.md` § 4); a day's figures are final only once it has.
- **reports** — the GST sales register, lodging tax and cashier shift already
  add these figures up, and export CSV.

---

## Rules that will bind it

- **Ask the owner before building anything** (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **Never show a figure the database hasn't agreed to; a missing one is a
  dash, never a zero** (`HANDOVER.md` § 5). Statutory figures reconcile to
  the rupee — the reports index files them as "Filed, not read"
  (`src/modules/reports/pages/Index.tsx`).
- **The ledger is append-only** — an export reads it; nothing corrects a
  posting except a reversal (root MEMORY 15, 24).
- **A GST figure is dated by the business date, not the moment of issue**
  (root MEMORY 44).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b` and `npx vitest run` — `src/test/boundaries.test.ts` fails if
this folder loses its `index.ts` or this `MODULE.md`.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
