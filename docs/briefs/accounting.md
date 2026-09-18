# Accounting — the Tally export — the brief

**Read `docs/briefs/README.md` first**, then this, then
`src/modules/accounting/MODULE.md`. Your decision is **D18-16** in
`docs/briefs/decisions-2026-09-18.md`. The whole plan is
`docs/BUILD-PLAN-2026-09-18.md` § 7; how the chats run together is
`docs/PARALLEL-PLAN-2026-09-18.md`.

**You own** `src/modules/accounting/`, `api/src/modules/accounting/` (front door
made and mounted, empty — add your routers to it; **never touch `server.ts`**),
and `db/tests/modules/accounting.sql`.

---

## What this service is

**One screen that hands the hotel's month to its accountant.** A date range,
three formats to choose from, a file. Nothing more: this is not a ledger, not a
chart of accounts, and it never posts anything back.

## The one rule that defines this service

**THE EXPORT AND THE REPORTS CAN NEVER DISAGREE.** Every figure in the file is
the figure the reports already print, read through the reports service's front
door (`buildReport`, `api/src/modules/reports/index.ts`) — not a fresh query of
your own over `folio_postings`. Sales, taxes and receipts are already defined
(D17-71, D17-72, D17-93, and `src/lib/glossary.ts`); a second definition is how
the Dashboard and the Manager report ended up disagreeing in August, and an
accountant finding two different sales figures for one month is worse than
having no export at all.

If `buildReport` does not give you what you need in the shape you need it,
**tell the master what and why**. Do not widen the reports service's files
yourself.

## The first version, and nothing more

1. **One screen**: a date range, a format, a button, the file.
2. **Three formats, all three offered** (D18-16) — the person exporting picks
   what their accountant asks for:
   - **Tally Prime XML**
   - **Tally ERP 9 XML**
   - **a day-book CSV**
3. **What is in it**: sales, the taxes on them, and receipts — by day, for the
   range. Room revenue, food, and the extra charges as separate lines, because
   that is how they already appear on the Manager report.
4. **A period nobody has closed is still exported**, and the screen says so —
   but a day that the night audit has not run is not silently treated as zero.
   **Say what is missing; never invent a number.**
5. **Nothing is written.** No table of this service's own holds a figure. If
   you think you need a migration, ask the master first and say why — you
   should need none.

## What to get right, because an accountant will find it

- **GSTIN and the property's own details** come from the property record
  (`heading`/`propertyFor` behind the reports door), never a literal
  (MEMORY 256).
- **A date belongs to the property** (migration 113). A GMT server must not
  move a sale into the previous day. The API suite runs in UTC so this fails on
  your machine rather than in Akkalkot.
- **Money is money**: two decimals, no rounding drift across a month, and the
  total of the days equals the total of the range. Prove that with a test.
- **XML is escaped.** A property called `Fidato & Co` must not break the file.

## Not in the first version

Purchase and supplier bills (finance's, and waiting on the owner), a chart of
accounts, ledger names mapped per hotel, posting back into Tally, payroll,
anything with a bank in it.

## What will break other chats if you touch it

`api/src/server.ts`, `api/src/mount.ts`, `src/lib/permissions.ts`,
`src/components/app/navigation.ts`, `src/components/ui/` — **the master's**.
`src/modules/reports/` and `src/modules/finance/` are other services': read
through their front doors, never their files.

**Who may export:** the owner, an administrator and the GM. `src/lib/permissions.ts`
already says who sees the ledgers; ask the master rather than editing that file.

## The gates

They run **in GitHub on every push** (`.github/workflows/ci.yml`), and a push
outside your lane is refused by the hook. Locally, to find out fast:

```powershell
npx tsc -b --force
npx vitest run src/modules/accounting src/test
cd api; npm test -- modules/accounting
```

**One full suite at a time on this machine** — several chats share it. Let the
Action run the whole thing. **A guard is not a guard until it has refused
something**: break each one, watch it fail, put it back, say so.

## When you finish

Your `CHANGELOG.md`, `DEFECTS.md`, `MODULE.md`; `npm run lane -- accounting`;
`npm run release -- accounting`. **You do not merge and you do not deploy.**
Commit on your branch, push, and send the master the head commit with your gate
numbers and the guards you saw fail.
