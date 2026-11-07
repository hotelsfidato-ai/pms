# Changelog — Contracts

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 30 September** (`MODULE.md`).

---

## 2026-11-07 · Allotments: rooms held under a contract (D27-383 item 8, built under D27-396; C-12 now built)

**Asked for.** The master's build-all brief, item 8: a block of rooms of a type held for a company or travel agent over dates, at their contract rate, with a release (days before arrival) after which unpicked rooms go back on sale at the night audit, recorded; a pickup is a booking against it; Availability and the Calendar show held rooms as held, never as sold; an allotment never overbooks the hotel. With the rooming list and the waitlist (reservations' entry of the same day).

**Shipped.**
- Migration **271** (`271_allotments.sql`): `allotments` (one contract, one room type, first and last night both held, rooms, release days, notes; kept by `app.keeps_companies()` as contracts are, C-6), `allotment_releases` (one row per allotment and night: rooms back on sale, the closing day, who), `reservations.allotment_id`; `app.allotment_held` (each night's rooms, picked, held - 0 once released); `app.inventory_grid` keeps 044's columns and its `available` is now less what is held (`occupied` and `sold` unchanged); `app.release_allotments(hotel, closing day)`, idempotent by `ON CONFLICT DO NOTHING`.
- Migration **273**: the three new tables join `app.test_hotel_classes()` (trading) and `waitlist` joins `owner_reset.steps()` before `reservations`, each patched in place (CON-5).
- `api/src/modules/contracts/allotments.ts`: `GET /allotments/:id`, `POST /allotments`, `PUT /allotments/:id` (change, or `active: false` to stop holding), under one advisory lock per hotel; `allotmentPickup` for book.ts, through the front door. The company's contracts answer carries `allotments`; a contract's dates may not be moved past one of its allotments.
- `pages/CompanyContracts.tsx`: each contract's **Allotments** (rooms and nights, release and the next one, booked from it, still held, back on sale, the contract's rate for the type or a dash), **Hold rooms**, **Change** (with **Stop holding**), **Book from it**; `components/AllotmentDialog.tsx`.
- Elsewhere, each the smallest line: the night audit calls `app.release_allotments` before it closes and answers `allotmentRoomsReleased`, shown on its result line; `/inventory` cells carry `held` and Rates' Rooms left shows "n held"; `/calendar-prices` carries `held` and the Calendar takes it off each type's free count and shows "+3h" with a key.

**Decided under D27-396** (the owner reviews later):
- An allotment belongs to one contract and its nights lie inside it, so "their contract rate" is never in doubt (C-3's contract in force on arrival is that contract); with no figure for its room type, the rate reads a dash and a booking takes the day's price (C-4).
- The release is rolling: each night's rooms nobody booked go back on sale at the audit closing (that night - release days), the industry's usual meaning; a hold whose first release would already be past is refused rather than released tonight.
- A booking from an allotment is made for its company (as Bill to company), priced by its contract; another room type, nights outside it, more rooms than it holds, a released night or a day use are refused by name. It takes held rooms even where the desk may not overbook.
- An undone night audit does not take a release back: the rooms may have been sold since. Stopping an allotment puts what it holds back on sale at once; its bookings stand.
- Kept by the owner, an administrator or the GM (as contracts, C-6); read by whoever reads companies or bookings; booked from by whoever may book.

**Proved** (this copy, `fidato_groups` and the API's scratch databases):
- Database: `db/tests/run.sh` on a scratch database, all 1913 assertions passed (allotments 15, waitlist 6, test hotels with the three classed) - its first run, before 273, failed "in no class: allotment_releases, allotments, waitlist" (CON-5). `contracts.sql` allotments 15/15 (held off availability and not sold; a pickup moves availability once; the audit of 7 Jan releases nothing, of 8 Jan 2 rooms, the same day again 0 with one row; reception refused; 0 rooms refused) and `reservations.sql` waitlist 6/6, run on this copy's database with the harness.
- API, one scratch database for the services this touches (reservations, contracts, night-audit, inventory, channel-manager, calendarPrices, leavingEarly, roleGate, reportFiles): 34 files, 420 of 428; `allotments.test.ts` 9/9 (who holds; nights inside the contract; a release already past; never an overbooking, naming the night; a pickup's five refusals with nothing written; made for the company at ₹2,100 contract rate with the hotel otherwise full and the desk barred from overbooking; a released night refused with its audit's date; never fewer than booked, type kept, stopping; a contract not shortened past an allotment; the night audit at Pune releasing 2 and its second press refused, one row kept), roleGate 80/80 with the D27-383 pin. The 8 failures: `suAvailability.test.ts`'s 7 timed out on this loaded PC and passed alone, 12/12; `calendarPrices.test.ts`'s exact-shape check now carries `held: 0` (changed), 5/5 alone. The whole API suite was started twice and did not finish: the PC restart stopped the first, the second ran 4 files in 15 minutes and was stopped.
- Guards seen failing: with the overbooking check, the pickup check and the rooming list's all-or-none each switched off, 5 allotment tests and 3 rooming-list tests failed; restored from git. With `ON CONFLICT` taken out of `app.release_allotments` the database test stopped on a duplicate release; with 044's `inventory_grid` back, "availability is less the rooms held" and "moves availability once" failed; 271 re-applied.
- After 273: `resetOrder` 5/5, `ownerReset` 15/15, `testHotels` 69/69, `calendarPrices` 5/5 (exit 0); `db/tests/rerun.sh` "all 259 migrations are re-runnable" (exit 0).
- A year of `app.inventory_grid` at 5EL, warm: 149 ms against 044's 150 ms.
- Screens, as the GM on this copy's demo: Demo Travels' contract → Hold rooms 20 Deluxe refused ("Only 7 Deluxe rooms are free on 20 Nov 2026 … never overbooks the hotel"), 3 held; the allotment line read "Booked from it 0 · Still held 3 … Rate: EP ₹3,200.00 / ₹3,600.00"; the Calendar's Deluxe 20 Nov "4 +3h" with "17 → 14" in the footer; Book from it → New booking "From the allotment of Demo Travels …", "3 left", ₹3,600 contract price; saved FH-5EL-2611-5031 with `allotment_id`, Demo Travels, ₹3,600, 10% commission.

**Left open.** Nothing sends an allotment's release to the booking sites by itself beyond the channel manager's own push of `available` (which now reads held rooms as not for sale).

---

## 2026-10-12 · "Rates", not "the rate calendar" (the owner's D27-307 (4))

**Shipped:** the contract window (`components/ContractDialog.tsx`): "Taken off
the price on Rates for the arrival date." and "... a third guest pays the
extra-person price on Rates."; a company with no contract
(`pages/CompanyContracts.tsx`): "Bookings for this company take the price on
Rates until a contract is added." **Proved:** no test asserted the old words;
opened as the GM on a scratch copy of the demo (D305 Demo Travels, Add
contract, both pricing modes) - all three read as above. MODULE.md's C-2 is
the owner's decision as worded then, left as it is.

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
