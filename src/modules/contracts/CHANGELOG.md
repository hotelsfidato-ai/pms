# Changelog — Contracts

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 30 September** (`MODULE.md`).

---

## 2026-10-02 · cp6 merged in (the launch), the migration renumbered 177, a day use kept typed, CON-4, the screens seen

Same branch and copy; `fidato_s41` migrated to 177.

**Asked for:** the master, on the owner's resume: merge cp6 (ffda580a,
migrations 162-176), renumber the migration 177, keep cp6's day use (D27-227,
D27-229, D27-230) typed-only with a test, finish the paused steps.

**Shipped:** `173_contracts.sql` is `177_contracts.sql`. The merge kept both
sides in `server.ts` (guest services and contracts), `navigation.test.ts`
(Distribution: the channel manager and Contracts built, Booking engine not)
and `BookingPage.tsx` (cp6's GST split and imports; the contract quote never
asked for a day use). `book.ts` merged by itself: cp6's "Type the day-use
price." refusal sits above the pricing branch. CON-4's fix (an edit asks for
a duplicate only on a changed name or GSTIN). The contract dialog's rates
grid on a phone: each plan on its own line over its two prices.
`onePage.test.tsx`'s mock answers `/contract-price`.

**Proved:** `npx tsc -b --force` exit 0; strip-check 180 files. Web: 30
files, 200 tests (navigation, src/test incl. migrationNumbers, guests,
reservations, contracts, lib); contractPrice's day-use test fails with the
`!dayUse` guard removed. API, one file at a time, no other build running:
contracts 8, roleGate 67, validate 12, newBooking 21, bookings 15,
feesAndDayUse 9, perBill 11, reports 31, all passed. Database:
`contracts.sql` 16 of 16 on a copy of `fidato_s41` at 177. Screens, as the
Owner at 1280x720: Contracts, a company, Edit company (a duplicate Agoda
ticked "Allowed · 30 days · -"), Add contract (saved, "In force", the rate
table), New booking (Deluxe: "Contract: Agoda 2026-27. No contract rate for
Deluxe · EP; the day's price." at ₹3,699; Superior for two: ₹2,800 and
"Contract: Agoda 2026-27"; a day use: no price, no contract line, "Type the
day's price"), Companies and agents' Add company; as Reception: Add company
with name, GSTIN and address only, no Edit or Add contract on the company's
page; at 375 px: the contract dialog, a company and Contracts, nothing
sideways.

**Found:** CON-4. And for the owner: cp6's "Rate includes GST" tick splits
whatever price the line carries, so on a contract-priced line it would split
the contract's own price; kept as cp6 built it, asked through the master.

**Left open:** the master's merge.

**Then, D27-233** (the owner took the recommendation): "Rate includes GST"
applies to a typed rate and the list price only. `BookingPage.tsx` greys it
on a contract-priced line with "Contract rates are before GST" and sends and
splits nothing there; `book.ts` reads `from_contract` and skips the split.
Failing tests first: contractPrice "greys Rate includes GST" failed (the tick
was enabled), contracts.test "never splits a contract rate" failed on the old
`book.ts` (2,380.95 stored for 2,500). After: web reservations and contracts
9 files, 31 tests; API contracts 9, newBooking 21, inclusiveGst 6, one at a
time; tsc exit 0; seen on the screen (Superior for two under Agoda's
contract: ₹2,800 + ₹140 GST, the tick greyed with its line).

---

## 2026-09-30 · Contracts built: Add/Edit company, a contract per company and hotel, the booking priced by it (D27-178, D27-184)

Branch `contracts/rates-30sep` (from cp6 24d99f2), copy
`.claude\worktrees\laughing-jepsen-2b2ea7`, database `fidato_s41`, API 8891, web 5291.

**Asked for:** D27-178, build every service still Not built yet. The lane
planned first; the owner took all thirteen recommendations (D27-184, C-1 to
C-13; `MODULE.md`).

**Shipped:** migration 177: companies gain kind, state,
PIN and credit allowed, and their credit figures become not-set instead of 0;
`contracts` (one in force per company, hotel and date), `contract_rates`
(single and double), `reservations.contract_id`, `app.contract_in_force`,
`app.contract_price`. Seven routes in `api/src/modules/contracts`. The
Contracts page and a company's page; the Add/Edit company and Add/Edit
contract dialogs; `gstinProblem` (the check digit) in `api/src/validate.ts`.
Outside this folder, claimed for these lines only: reservations (`book.ts`
prices by the contract and stamps it and its commission; `BookingPage.tsx`
quotes through `/contract-price` and shows "Contract: <name>"), finance
(`postings.ts` refuses Bill to company without credit; `perBill.test.ts`'s
company allowed credit), guests (Add company on Companies and agents), and
the master's files it allowed (T-2): `server.ts`, `roleGate.ts` and its
test, `permissions.ts` (front_desk `company: create`), `navigation.test.ts`.

**Found:** CON-1 (an administrator could not change a company), CON-2 (a
credit limit nobody set read as 0), CON-3 (the booking sites are company
records; open with the owner).

**Proved:** `npx tsc -b --force` exit 0; `api` strip-check 165 files; web
tests contracts, contractPrice (fails on cp6's booking page), navigation,
boundaries, guests, reservations, lib: pass, except migrationNumbers on the
gap to 173, since renumbered 177. The API tests and the database test are
written and not yet run (the master's word).

**Left open:** the API and database runs; the screens in the browser pane
once `fidato_s41` is migrated; CON-3's answer.

**Commits:** 76c09aa, 5be91bf, 5f44249, ec8475a and the notes commit.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/contracts`, guarded), `pages/Contracts.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
