# Changelog — inventory and rates

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-02 · Rates always open, in the Calendar's look (D27-237 5.1–5.3)

Branch `rates/always-open-2oct` from cp6 `3336a219`, copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45` (migrated to cp6's 179 files), API 8903, web 5303.

**Asked for:** the owner's D27-237:
- 5.1: every room type always open with all its rows, a dash where nothing is set, in the Calendar's look. This replaces D27-206's "closed by default".
- 5.2: rooms left under each base price; the Rooms left tab stays.
- 5.3: "How rates are built" below the calendar.
- At 375, "+ per extra adult" on one line.

**Shipped** (`pages/Rates.tsx`):
- The card's own toolbar holds the two-week arrows, the range and Today (shown only away from the business date). The business date is the window the server chose first.
- Each day has a 12px uppercase weekday caption over a 16px day number. The business date's column is navy, and weekends are a grey wash.
- Each room type is its own `tbody` (named for it):
  - a grey group row with the base, and "N left" under it (red at 0, a dash where none is held), from the `GET /inventory` read the Rooms left tab already makes;
  - then every break-up row, 40px tall with 14px labels on one line, in a 152px label column.
- How the day sold is drawn as the Calendar's footer: paying rooms sold, a 4px orange capsule of occupancy and its percentage, then ADR and Revenue.
- The setup card sits under the calendar.
- On a phone the grid's card runs edge to edge, as the Calendar's does. The Rooms left tab shares the same frame.

**Proved:**
- `freeTick.test.tsx`: 6 tests, 3 of them new or rewritten (always open with its rows and the dash; rooms left under the base; the setup below the grid and Today back on the business date). All 3 failed on the old screen.
- `src/modules/inventory`: 13. primaryAction, navigation and boundaries: 36 in all, with inventory. Web `tsc` exit 0.
- **Opened on `fidato_s45` as the GM:**
  - At 1280 x 800: TUE 25 in navy; Superior "₹3,000 / 4 left"; Deluxe with its extra-adult and extra-child rows; the footer's capsules (41% … 59%); "How rates are built" below.
  - At 375: "+ per extra adult" is one line (40px tall, 152px column). Every font size is on the ladder, and the page does not scroll sideways.

**Also in this branch, outside this service: Find a screen finds guests and bookings (D27-239).** The owner answered the plan's three questions as recommended (2 October).
- `src/components/app/CommandPalette.tsx`: search starts at 3 characters, or 4 digits of a phone.
  - It matches the guest's name or the booking reference. A phone matches only for a role that also sees guests, as the server's WITHHELD blanks it for the rest.
  - Results come under the screens: in house first, then upcoming, then past; at most 8.
  - Each result opens on All bookings at `?res=<id>`.
  - Only a role that sees bookings searches; the others' palette is as before.
  - It uses All bookings' own `GET /stays` read and cache entry. ponytail: the whole list is read; a server search with its own gate line comes in when a hotel's list gets slow.
- Front desk's door exports `STAY_LABEL`, the bookings table's status words.
- `commandPalette.test.tsx` has 3 tests, all failing on the old palette:
  - a name finds the guest's bookings and opens one on All bookings;
  - a reference and 4 phone digits find bookings, and 2 letters ask for nothing;
  - housekeeping gets no phone match but still a name match, and the chef gets nothing and asks for nothing.
- After it: primaryAction, navigation, boundaries, `src/components/app`, inventory and front-desk: 21 files, 114 passed; web `tsc` exit 0.
- Opened on `fidato_s45` as the GM:
  - At 1280: "asha" found 4 bookings, and Enter opened FH-5EL-2608-5032's panel on All bookings.
  - At 375: "98123" found 3 by phone; the rows fit, and the page does not scroll sideways.

**Left open:** at 375 the label column takes 152px, so about three days show beside it. In Find a screen at 375, a booking's second line (reference and dates) ends in an ellipsis.

---

## 2026-09-30 · Rates: the calendar opens to the break-up; Set prices (D27-206)

Branch `rates/base-addons-30sep` (cp6 e350e71b taken in), copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** the owner's screenshot of Rates (D27-206): the calendar shows the break-up - CP, MAP, AP, AI, the extra adult and child - and says how to change a day or a range of days.
**Shipped:** each room type's line is a button that opens rows under it (2 guests; CP, MAP, AP, AI for 2 guests; + per extra adult; + per extra child), closed by default, read when opened from `GET /pricing?breakup=<room type>` - one query, every figure `app.tariff_guests` / `app.extra_person_rates`; a room that sleeps one gets "· 1 guest" rows. A "Set prices" button (room type, from, through, price) is the tapped price's dialog and call; a line under the calendar says a price can be tapped. No migration, no new route.
**Proved:** each seen failing first - `api/test/modules/inventory/pricing.test.ts` 16 passed (the rows equal `app.tariff_for` plan by plan, day by day; an unset add-on is null); `freeTick.test.tsx` (the rows and the dash; reception sees rows, no Set prices, no tap; Set prices sends from and through + 1). Web inventory 11 passed; tsc web and api clean; strip-check 166 files.
In the app (the pane, `fidato_s45` at 166): as the owner at 1280, Deluxe opens to 2 guests ₹4,400, CP · 2 guests ₹5,400, MAP/AP/AI a dash, + per extra adult ₹1,000, + per extra child ₹400; Set prices offers only Superior (the base room type) and ₹3,200 for 1-5 Sep moved Superior, Deluxe (₹3,840) and the opened rows (₹4,640 / ₹5,640); the hint shows. As reception at 1280 and 390: the rows, no Set prices, no Edit or Remove, no tappable price, no hint. At 390 with the rows open the page is as wide as the screen (the calendar scrolls inside its card).
**Found:** the read is about 3x slower for a signed-in person than my first figure. `api/src/db.ts` `withUser` puts the raw Firebase uid into `app.user_id`, and `app.current_user_id()` (017) resolves it through an exception block and a staff lookup on every row-security check. Measured here: the calendar 0.92-1.1 s (0.24 s with a staff uuid as the subject), an opened room type 2.7-2.9 s (0.65-0.77 s). It is the core's, for every request, not this screen's; reported to the master with the one-line fix.
**Then, the owner's answer (the master, 30 Sep):** the two "+ per extra" rows show only for a room type a further guest fits in (`sleeps > guests`) - a guest who can never be sold must not show a figure, the same rule as the dash. `freeTick.test.tsx` "shows no extra-guest rows for a room type no further guest fits in", seen failing first; inventory web 12 passed. Set prices is the screen's primary button. Opened again as the owner and as reception at 1280 and 390: Superior (sleeps 2) has no extra rows, Deluxe (sleeps 3) keeps them; one opened line filled in 3.1-3.4 s in the browser as a signed-in owner.
**Left open:** the slow identity path (the master's, `api/src/db.ts`).

---

## 2026-09-30 · Rates are a base plus add-ons; one Rates screen; Room types is the list (D27-188, D27-194)

Branch `rates/base-addons-30sep` (from cp6 c01b150, e4c5929 taken in), copy `.claudeworktreesmystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** the owner's D27-188, the details in D27-194: a base plus add-ons in two modes; one Rates screen for the Rate calendar and Rate performance; Room types just the list; a Configuration page for the taxes (admin). Plan sent to the master first; every question answered before building.
**Shipped:**
- Migration 162: `app.price_parts` is the one definition. A base is a `rates` row on EP covering one guest; a type's own base, else (mode b) the base room type's plus its difference (rupees or %, whole rupees); add-ons in `rate_offsets` (new kinds `double`, `extra_adult`, `extra_child` beside `meal_plan`; a `unit`), set once from -infinity by `app.set_addon`. A night: 1 guest = base; 2 (adult or child) = + double occupancy; from the 3rd, extra adult / child; meals per guest. `price_for`, `rate_for`, `extra_person_rates`, `tariff_for`, `set_rate`, `set_offset`, `set_basis_price` keep their signatures; every price set before 162 (covers NULL) prices exactly as it did. `set_rate`'s split keeps `covers_persons` and 090's two stamping triggers go (INV-9). `app.tariff_guests` for the channel manager. `tax_rules` takes `laundry`.
- API: `GET /pricing` carries the setup, add-ons, differences, rack and the older prices (`?plan=` for one plan's cells); `PUT /pricing/basis` null = each type its own base; `PUT /pricing/base` takes a room type; `PUT /pricing/addon` (roleGate PRICE, pinned); `GET /rates` is each day's hotel totals (D27-151).
- Outside this service, as the master routed: the channel manager's by-guest prices read `app.tariff_guests` (`ari/source.ts`) and its content's normal price `app.price_for` (`content/store.ts`); the night-audit report's "normal" rate and `property.ts`'s rooms read `app.price_for` (EP); laundry charges post under their own GST heading (finance's `tax.ts`, `data/tax.ts`, `TaxRulesCard.tsx`; `laundry.ts`).
- Screens: `pages/Rates.tsx` (was Grids.tsx): how rates are built, the base calendar with each day's performance, older prices with Remove, Rooms left and restrictions, report links; read-only for everyone but the rate setters. Pricing.tsx and RatePlans.tsx deleted; `/pricing`, `/rate-plans`, `/grids` open Rates. Room types loses the three cards and the rack line; the front desk's card is `components/FrontDeskCard.tsx`.
**Found:** INV-9 (a split base lost "one guest"; choosing a base type re-read older prices). The new older-prices list listed none (NOT on a NULL) - caught by its own API test before commit.
**Proved:** `db/tests/run.sh` all 1285 assertions; `db/tests/rerun.sh` 162 migrations re-runnable (again after the laundry part); API one file at a time: pricing 15, unpriced 2, zeroPrices 6, inventory 29, rateSetters 17, roleGate 60, channel-manager suAvailability 12 and suContent 11, reports 31, admin settings 7 and propertyAdmin 39, laundry 27 (the new laundry test seen failing with its line taken out). Web: inventory, admin, finance, components/app and App tests pass except navigation's "two places the same name" (the Configuration name, with the master). In the app: Rates as the revenue manager (setup saved, Superior base ₹3,000, Deluxe derived +20% = ₹3,600), the tariff through `GET /tariff` (Deluxe CP 3 adults ₹6,900; 1 adult + 1 child EP ₹4,400; MAP unset not sold), Room types, Configuration as the GM, Rates read-only as reception from the old `/grids` address.
**Left open:** the Configuration name clash; the migration number; the front desk's two rack reads (with the master for the booking lane).

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part D: paying rooms sold; EP not RO; dates; said, not silent (D27-151, D27-164; QA FD-12, RT-6, RT-7, RT-8)

Branch `fix/leftovers-28sep` (cp6 7c52bb9, round D, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** Rate calendar and Rate performance say "paying rooms sold" with a note that complimentary rooms are left out; Rate performance drops day use and its stale comment is corrected (`rateGrid.ts`). Pricing and Rate plans list the meal plans as code with words and no RO (`pricing.ts`, `rates.ts`; RT-7). The Rate calendar's range and its two dialogs print dates as 25 Aug 2026 (FD-12). A room type's counts say why Save is off (RT-6). Pricing's toast comes with the new base (RT-8). Rate performance: "Editing comes once a channel manager is connected" (was "at Stage 9").
**Proved:** web inventory tests passed; api `unpriced.test.ts` 2 passed; the lists read from the API ("EP · Room only | CP · Room + breakfast | …", no RO).

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
