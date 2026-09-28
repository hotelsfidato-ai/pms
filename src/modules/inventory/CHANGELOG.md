# Changelog — inventory and rates

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-28 · Fix round D: 0 only ticked Free, the unset difference, rooms (QA of 28 Sep)

**Asked for:** D27-120 and the QA's Rooms, rates and setup table.
**Shipped:** QA X-1/RT-1/RT-2 - a price of 0 only with a "Free" tick (validate.ts
priceProblem): the rack rate, a season, the rate calendar's price and extra adult
and child (each its own tick), the pricing base; the same at the menu's dish,
the store's receipt cost, a purchase line and the laundry price list; 0 in a
room-types or menu file is refused. QA RT-3 - migration 155: a room type or meal
plan with no difference ever set is not priced (a dash, no rack fallback); set
for some dates, the base applies on others (16 Sep); a typed 0 is "the same".
QA RT-4 - a room number at most 10, a floor 0-99.
**Proved:** api inventory/zeroPrices.test.ts 6 (all fail on the old routes),
pricing.test.ts 11, roomLimits.test.ts 2 (both fail on the old code);
db/tests/modules/inventory.sql (three RT-3 assertions false on 090's function);
web freeTick.test.tsx. On screen: 0 unticked refused on Rate plans; Pricing with
only a base shows "Not priced" for every other room and plan.
**Left open:** RT-5 (GST outside the slabs) is with the CA. A dish variation's and
an add-on's price, a banquet hall (round E) and a received cost against an order
are outside the owner's list for the tick.
**Commits:** 221084e, 40b75ed, ee4eccb.

---

## 2026-09-26 · INV-2 held by tests; the Rate calendar is headed "Rate calendar" (D25-28)

**Asked for:** the owner's D25-27 (a test for each fix built but held by none, then close it; no behaviour changed), in the five-tests session, branch `tests/five-25sep`. And D25-28: the Rate calendar screen is headed "Rate calendar", its menu name. **Shipped:** `pages/Grids.tsx`'s three headings; `inventory.test.tsx` reads the Rate calendar's heading from `nav.ts`, and "Room types is headed with its menu name (INV-2)" reads Room types' in its three states. **Proved:** seen failing with "The house" and "Inventory and rates" put back; pass on the fix. INV-2 moved to Fixed. **Left open:** nothing here. **Commits:** `689f837`.

---

## 2026-09-24 · INV-7, a wrong id no longer loses the default cancellation policy

**Asked for:** the master, 24 September, with the Store's D22-20 on
`admin/finish-24sep`. **Shipped:** `PUT /:code/cancellation-policies/:id/default`
finds the policy (`for update`) before it clears the old default. **Proved:**
`api/test/modules/inventory/policyDefault.test.ts` (fails on cp6's route);
`roleGate.test.ts` now probes the route as every role. See DEFECTS INV-7.

---

## 2026-09-16 · INV-3, what the inventory subtracts (room 308), INV-5

**Asked for:** by the owner, in order — (1) INV-3, two responses turn an
unpriced room into 0, which the channel manager (SU) is waiting on; (2) prove
with a test whether `GET /:code/inventory` subtracts a room that is out of
service in every way a room can be marked so, because the Rooms screen and the
notification bell disagree about room 308; (3) INV-5, approved 16 September:
only `RATE_SETTER_ROLES` may set a price on the Rate calendar — the screen and
the write route both refuse everyone else. `src/lib/permissions.ts` not to be
touched: the master is adding the revenue manager to that list.

**Shipped** — branch `inventory/inv-3-unpriced-dash`, copy `D:\fidato-inventory`
- INV-3: `GET /:code/rates` (`rateGrid.ts`) and `GET /:code/room-types`
  (`roomTypesAndPlans.ts`) send an unpriced rack rate as `null`. Rate
  performance prints "rack —", its tooltip a dash, and no longer marks a sale
  "below rack" when there is no rack; the routed-nowhere room-type list prints
  a dash. Types `number | null` in `data/rateGrid.ts`, `data/unroutedLists.ts`.
- INV-5, screen: `canSee: setsRates` on the Rate calendar (`nav.ts`) and
  `RequireAccess` around `/h/:code/grids` (`routes.tsx`).
- INV-5, server: `api/src/modules/inventory/rateSetters.ts` — `setsRates`
  (group administrator, or a listed role at THIS hotel) and the server's copy
  of the list. `PUT /:code/rate-grid` asks it first and answers 403 with a
  sentence naming who can.
- Tests: `api/test/modules/inventory/unpriced.test.ts`,
  `outOfService.test.ts`, `rateSetters.test.ts`;
  `src/modules/inventory/inventory.test.tsx` (the first web test in this folder).
- `DEFECTS.md`: INV-3 and INV-5 moved to Fixed, INV-6 new. `MODULE.md`: the
  claim in `.claims/`, 27 endpoints with `pricing.ts`, which screens are
  guarded, what "sellable" reads, the test files, two requests.

**Found**
- **INV-6** (task 2's answer). The inventory subtracts a room for a block of
  any of the five reasons (NC included), inclusive at both ends, open-ended, and
  a retired room — and does NOT read `housekeeping_status`. The bell reads the
  block too; the Rooms screen reads the status. 308's state in the development
  database (block 14 Aug → open, status `inspected`) was reproduced through the
  API: releasing ONE of a room's two blocks sets it `dirty` while the other
  still covers today, and housekeeping can then clean it. The fix is in
  housekeeping, front desk and the core, and which record is the definition is
  the owner's call.
- INV-5 closed one write. Still asking no role: `PUT /:code/pricing/*`,
  `PUT /:code/room-types/:id/rate`, `POST`/`DELETE /:code/rate-plans`,
  `POST /:code/restrictions`; and the Rate plans screen is open to `rate: READ`.
- Mine: the first run of `outOfService.test.ts` picked a room the demo leaves
  `occupied`, so retiring it was (rightly) refused — MEMORY 107's shape, a
  fixture chosen by sort order. Read as a fixture fault before anything else
  (MEMORY 259); the picker now asks for a vacant room.
- The server's `RATE_SETTER_ROLES` is a copy of the website's. Held together by
  a test, not by an import; the master's revenue-manager change has to touch
  both (request in `MODULE.md`).

**Proved** — run in `D:\fidato-inventory` on 16 September, judged by exit code
- `npx tsc -b --force`: exit 0. `cd api; npx tsc --noEmit`: exit 0.
  `npm run strip-check`: 70 files load, exit 0.
- `npx vitest run`: 215 passed, 20 files, exit 0.
- `cd api; npm test`: 399 passed, 32 files, exit 0.
- `bash db/tests/run.sh`: all 622 assertions passed, exit 0.
- `npm run build`: "no test sign-in in dist (6 files checked)", exit 0.
- `npm run lane -- inventory`: "All inside the inventory lane", exit 0 (the
  three API test files listed as nobody's; `.claude/launch.json` changed
  locally for this copy's servers and not committed).
- Guards seen to fail: INV-3 — both server lines put back, both cases failed
  "expected +0 to be null". INV-6 — the inventory pointed at the room's status
  instead of its blocks, 10 of 11 failed (the retired room, which both rules
  exclude, stayed green). INV-5 server — the check switched off, 10 of 16
  failed (nine roles and the GM from another hotel). INV-5 screen — the route
  guard removed, 1 of 3 failed; `canSee` removed, 2 of 3 failed.

**Left open**
- **The screens have not been opened in a browser yet.** The preview tool
  starts servers only inside `D:\fidato pms`, and this copy's servers need this
  copy. To do before this branch is called done: Rate performance with an
  unpriced type, the Rate calendar as Test Reception (refused) and Test GM
  (opens). A database for it is built: `fidato_inventory`, demo loaded.
- For the owner: which record defines "out of service" (INV-6); whether the
  other price writes and the Rate plans screen follow INV-5.
- For the master: the revenue manager in both lists; INV-6's lesson for the
  root `MEMORY.md`.
- The claim stays until the screens are opened and the owner has answered.

**Commits:** see the branch.

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — Room types, Rate plans, Cancellation terms,
  Rate calendar, Rate performance; `routes.tsx`; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/inventory/index.ts`, which mounts
  `rates.ts` and `inventorySetup.ts`.
- Step 4a (`23cd2e4`): the mixed data files cut by service, in place —
  `rateGrid.ts` out of `billing.ts`, `rateSetup.ts` out of `admin.ts`,
  `unroutedLists.ts` out of `directory.ts`; `roomSetup.ts` gave its tax and
  commissioning parts to finance and admin.
- Step 4b (`8a1e9a4`): `UnroutedLists.tsx` cut out of `Directory.tsx` — the
  two older screens no address reaches, kept pending the owner.
- Step 4 (`a3315db`): moved in — `data/` rateGrid, rateSetup, rates,
  roomSetup, unroutedLists (from `src/data/repositories/`); pages
  CancellationTerms, Grids, RatePlans, Rates, RoomSetup, UnroutedLists (from
  `src/pages/`). The door gained `getInventory`, `getTariff` and `Tariff` for
  New booking.
- This brief: `MODULE.md` rewritten from the code — five screens, 23
  endpoints, the tables and migrations, the rules; this file; `DEFECTS.md` with
  two new entries and eleven root entries indexed.

**Found** (while writing the brief)
- INV-1 · `GET /api/hotels/rate-plans` can never run — an earlier `GET /:code`
  answers it. Checked with a minimal reproduction on the installed Hono.
- INV-2 · Room types is headed "The house", Rate calendar "Inventory and rates".

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
- INV-1: two Hono routers mounted in the server's order (`/:code`, then
  `/rate-plans`) answered `/api/hotels/rate-plans` with the first one's 404.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- INV-1 and INV-2 — not fixed; INV-2 is a naming call for the owner.
- The server code is still in `api/src/routes/rates.ts` and parts of
  `inventorySetup.ts`, `billing.ts` and `directory.ts`; moving it is step 5,
  in progress elsewhere.
- `api/test/inventory.test.ts` has not moved (step 7);
  `db/tests/modules/inventory.sql` does not exist yet.

**Commits:** `e9dd6b1` · `23cd2e4` · `8a1e9a4` · `a3315db`, and the commit that
added this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 2) · One main action per screen

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 9, "Rates, availability, STAAH") are the record.
