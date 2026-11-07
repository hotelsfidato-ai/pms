# Changelog — the store

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-11-07 · Expiry alerts on stock (the owner's D27-383, item 11; built under D27-396)

**Asked for:** item 11 of the owner's approved list (`.local/hms-audit.html`, Step 2), through the master's build-all helper: from the use-by dates already recorded, per store and item, what expires within a warning period and what has expired and is still on the shelf, oldest first, with what is left of each delivery (first in, first out by use-by); on the Store (a tile and a filter) and in the Notifications the Inventory Manager and the GM get. An item with no use-by is never an alert. Waste stays the way off. Purchasing's half (the bill against the order) is in purchasing's CHANGELOG.
**Shipped** Migration 269 (`269_expiry_warning.sql`): `hotels.expiry_warn_days`, 7 to start, 1 to 90, never blank; a test hotel copies it (`app.test_hotel_hotels_columns`, 242's list plus one). `api/src/modules/stores/expiry.ts`: `lotsLeft` (pure) walks an item's movements in the order written and keeps what is left of each delivery per store - stock going out is taken from the earliest use-by there, a delivery with no use-by last; a move carries each piece's use-by to the other store; an undo puts back exactly what its movement took (or takes off exactly what it put); stock below nothing is owed and the next delivery pays it. `expiryAlerts` lists every delivery past its use-by or within the warning, oldest first. `GET /stores` carries `expiry` per item and `{ warnDays, today, mayChange }`; `PUT /stores/expiry-warning` (the owner, an Admin or the GM, `WARNING_SETTERS`; its own refusal sentence). The bell (`api/src/routes/notifications.ts`, core): "N deliveries past the use-by, still on the shelf" and "N deliveries to use within 7 days", the first three named, each opening the Store on its tile. The Store: two tiles first, **Expired** and **Expiring soon** (warm, jobs), ten tiles now five a row; picked, the list is the oldest use-by first, with one line saying what the tile means and **Change the warning** (a dialog, 1 to 90 days) where the server says `mayChange`; each card lists its deliveries near or past the use-by in red or yellow ("Main store: 10 litre from the delivery of 7 Nov 2026 - expired, use by 5 Nov 2026") and an **Expired** pill. The Days view reads the same tiles. Manual A9.4, A9.5 (new "Use-by dates" part, figure A9-50), A9.7.
**Decided under D27-396** (the owner reviews): **7 days** to start, any whole number from 1 to 90, per hotel; **first expiring, first out** for what is left (so Waste of expired stock takes off exactly that delivery; FIFO by arrival would leave the expired line standing after it was wasted), a delivery with no use-by taken last, as keeping - never an alert, never a guess; "today" is the **property's calendar day**, not its business day (a late night audit does not keep milk fresh); expired means the use-by is **before** today (on the day itself it is "use by"); the bell goes to **whoever may correct a count** (owner, Admin, GM, hotel manager, Inventory Manager) - the people the crockery-count notice already reaches, so not the kitchen manager; the warning is set by **the owner, an Admin or the GM**, on the Store, not on Settings - first built for whoever sets levels, but the hotels row lets only those three change it (`app.manages_hotel`), so the Inventory Manager's save answered 200 and changed nothing; the API test caught it; a notice's id carries the day and the count, so a dismissed one comes back when more expires or a day passes.
**Proved** `api/test/modules/stores/expiry.test.ts` (FEFO, a move and its undo, an undone delivery and issue, owed stock; through the API: expired and within 7 days, the seventh day in, a month out and no use-by never listed, an issue takes the expired first and a move carries the use-by, the bell for the Inventory Manager and the GM and not reception, Waste clears it, the warning refused to the kitchen manager and outside 1 to 90 with nothing changed, 30 days lists the rice); `storeDays.test.tsx` (the two tiles counted and warm, the card's lines, the note, the dialog refusing 0 before it sends, then 10 sent; not offered to a chef); "expiry warning" in `db/tests/modules/stores.sql` 6/6. Exit codes in the master's report.
**Left open** (the owner's): the kitchen manager in the bell (they record waste but do not correct counts); an expiry report; the use-by on the Days view; a delivery received with its use-by already past is accepted as before.

## 2026-10-29 · Release 16: the owner's answers (D27-378) - the Kitchen store marked, Kitchen stock in the kitchen's menu

**Asked for:** the owner's D27-378, through the master: each hotel's Kitchen store marked by the migration, and a new hotel's, as the Bar store was; "Kitchen stock" in the kitchen manager's and the chef's Restaurant menu, like Bar stock. Everything else kept as built. cp6 (release 15, migration 250) merged first; `owner_reset.steps()` needs nothing: `recipe_lines` and the mark are setup, which a reset keeps.
**Shipped** Migration 251 marks each hotel's store named "Kitchen store" (never a bar store or counter) where the hotel has none marked, so a replay keeps the GM's choice; `app.default_stores` (238's) marks a new hotel's. `/pos/:code/kitchen-stock` (`KitchenStockPage`, routes.tsx) and its `nav.ts` entry (order 46, working menus and `canSee` the kitchen manager and the chef). Manual: A9.11, A8's screen list, A0.4's Restaurant menu, B2.2's menus per role.
**Proved** `kitchenStock.test.ts` 6/6 (5EL's Kitchen store came marked); "kitchen stock" in the db suite 13/13 (a new hotel's Kitchen store, and only it); the replay of 251 (then numbered 253) on a kept scratch database marked an unmarked hotel's Kitchen store and left a hotel whose GM chose its Main store alone - and without its backfill left the first unmarked. Taken out and failing: the new hotel's mark (4 API tests), the entry's working menus (2 web tests), its `canSee` (4 web tests).

## 2026-10-29 · Release 16: Inventory's Restaurant tab - the kitchen's sheet and recipes (the owner's D27-373, D27-374)

**Asked for:** the master, 28-29 October: the kitchen store's daily sheet and recipes, the bar's way; every KOT takes the recipe; no recipe takes nothing and is listed; sizes and add-ons their own lines; a KOT always goes, below zero red; struck before the kitchen had it gives back, after counts as wastage with the reason.
**Shipped** Migration 251: `locations.is_kitchen_store` (one per hotel, never the bar's store or counter, NOTHING marked by the migration), `recipe_lines` (a dish, a size, a side, a numbered add-on; for one, in the Store item's unit; setup in `test_hotel_classes`), the trigger `pos_order_lines_take_from_kitchen` (sent: one issue per Store item to the outlet, marked with the line; struck once sent, or fewer of it: the issue undone and written again as the part still sold and the part wasted, "Struck after the KOT: <reason>"). `kitchenSheet.ts` under `/kitchen-stock/`: the sheet, the count (`saveCount`), the kitchen store's mark, the recipes; `KITCHEN_KEEPERS` in `stockGrants.ts`; the five routes in `roleGate.ts`. `pages/KitchenStock.tsx` (Today's sheet, Recipes) as Inventory's Restaurant tab; `data/kitchen.ts`. Inventory's keywords find it by "recipes" and "kitchen stock". The manual: A9.11 (the kitchen's day, recipes, the sheet, figures A9-48 and A9-49 to be taken), A8.11 points there.
**Proved** `api/test/modules/stores/kitchenStock.test.ts` 6/6; `src/modules/stores/kitchenStock.test.tsx` 3/3; "kitchen stock" in `db/tests/modules/stores.sql` 13/13. Each guard taken out failed its test, then restored: the struck copy taking again (stock 4.2, not 4.4), the strike-to-wastage rewrite (no wastage), a size's lines, a side's, a numbered add-on's, the keepers' check on recipes, the readers' check on the sheet, the bar's store refused as the kitchen's (API), and the database's "never the bar's" check (the suite stopped).
**Left open** (questions for the owner, in the hand-back): whether the migration should mark each hotel's "Kitchen store"; the hotel manager setting recipes; a Kitchen stock entry in the kitchen manager's and chef's menus; whether the night audit waits for the kitchen's count; a kitchen stock report.

## 2026-10-25 · Release 13: the Bar store and the Bar counter (the owner's D27-361)

**Shipped** Migration 238: the Bar counter beside every Bar store, each drink counted poured, whole or by packet with its register kind, brand and imported, the closing and morning counts, the counter's requests (`barRequests.ts`: the GM or the Inventory Manager approves, never their own; approving moves store to counter), "Bar closed today". Every KOT takes from the counter. `barSheet.ts` by place and moment; `BarStock.tsx`: Counter or Store, Closing or Morning count, Requests, the drinks on Set up, the FLR register buttons. The pour picker now says what the store holds "in the store" (MEMORY 429). **Proved** `api/test/modules/stores/barStock.test.ts`, `barStock.test.tsx`. The root `CHANGELOG.md` has the whole entry.

## 2026-10-21 · Bar stock, like the paper register (the owner's D27-356)

**Shipped** `pages/BarStock.tsx` (`/pos/:code/bar-stock`, Restaurant menu; Inventory's Bar tab): today's sheet like the register or simple (`barSheet.ts`, `locations.bar_sheet`), its count through the Store's own (`saveCount`, `countLinesProblem`), bills (Purchasing's `BarBills`, through its front door), set up. `BAR_KEEPERS` and `holdsRoleAt` in `stockGrants.ts`. A bar bill's line goes into the bar's store on Purchasing's rule. **Proved** `api/test/modules/stores/barStock.test.ts`, `barStock.test.tsx`. The root `CHANGELOG.md` has the whole entry.

## 2026-10-21 · The bar's stock (the owner's D27-354)

**Shipped** Inventory (Bar; Restaurant to come): what each bar dish and size takes (`barPours.ts`, `bar_pours`, migration 235), taken off the Bar store by a trigger when the line is sent; the count of a drink in full bottles and ml, opened from a link; drinks shown "5 + 630 ml"; the Store's door lends `barStore`, `barDrinks`, `addBarDrink` and a bar bill's id on a receipt. **Proved** `api/test/modules/stores/barStock.test.ts`, `barStock.test.tsx`, "bar stock" in `db/tests/modules/stores.sql`. The root `CHANGELOG.md` has the whole entry.

## 2026-10-02 · The Store like the Calendar: tiles, Days, by outlet, GST, running average, crockery (D27-238, D27-242)

**Asked for:** the master, 2 October (D27-238): tiles across the top; a Days
view, items x 14 business days, with a footer per day; group by outlet against
the till's sales; GST on purchases (amount, rate, claimable) on the Store's
Receive and Purchasing's lines; a running-average cost; a department on issues
and an expiry on deliveries; phase 2A crockery (breakage with who, par per
outlet, last counted and a monthly reminder); a Reports link (D27-240). Plan
first; the owner answered the twelve questions (D27-242):
- Q1 a cell is +in over -out, blank when nothing moved, 14 days to today;
- Q2 the Below level tile replaces the yellow list;
- Q3 the tile meanings as planned;
- Q4 sales only for roles that may read reports;
- Q5 CHANGED: food cost = costs before GST over sales before GST, set now for
  every hotel;
- Q6 cost before GST, then rate (0/5/18/40 offered), amount filled and
  editable, claimable; Purchasing at delivery;
- Q7 the running-average rules as planned;
- Q8 CHANGED: department is free text;
- Q9 expiry shown in History only;
- Q10 crockery uses Places (restaurant, bar, kitchen), none created; breakage
  asks who or Not known;
- Q11 the bell for crockery places 30+ days uncounted;
- Q12 CHANGED: the reset clears the Store's transactions too.
Branch `stores/calendar-look-2oct` from cp6 `3336a219`.

**Shipped:**
- Migration 180 `180_store_days_gst_and_crockery.sql` (written as 183; renumbered at merge):
  - stock_movements.gst_rate / gst_amount / gst_claimable (a delivery's, all
    three or none), expires_on, department (an issue's), broken_by, and the
    kind `breakage` (crockery only);
  - the same GST three and expires_on on purchase_request_lines;
  - stock_items.crockery, with 112's place trigger replaced so crockery may sit
    at a restaurant, bar or kitchen place;
  - stock_count_lines (every counted line, append-only);
  - hotels.food_cost_basis = 'before_gst';
  - app.stock_movement_costs, the running-average walk; app.stock_unit_cost
    reads it.
- Server:
  - GET /stores carries the tiles' data and the in-use places;
  - GET /stores/days (roleGate pinned);
  - movements take GST, expiry, department and breakage;
  - counts keep every line;
  - moves, counts and levels work at crockery places;
  - the crockery-count bell (notifications.ts);
  - Purchasing's delivery takes each line's GST and use-by;
  - the doors: purchasing awaitingDelivery, pos outletSales;
  - reset-property.ts clears stock_count_lines then stock_movements, lifting
    both append-only guards.
- Screens:
  - the eight tiles (Below level replaces the yellow list);
  - Shelf | Days;
  - the fourteen-day grid (opens on today, footer pinned, Outlet grouping with
    sales and %);
  - Receive's GST and Use by; Department on Issue;
  - Broken; the crockery tick;
  - the Reports menu (seven roles, a pinned copy);
  - Purchasing's delivery GST columns.

**Found:** the frozen suite's weighted-average checks (63.60, then 62) give
the same answers under the running average, so it needed no change.

**Proved:**
- Database: stores.sql 78/78 on fidato_s46. With 069's all-time average put
  back, the four average checks fail (110, 65, 120, 53.33).
- API, one scratch run of 13 files: 340/341. Its one failure, purchasingGrants,
  timed out at 20 s under load; run alone it passed 8/8. New: daysAndCrockery 6,
  doors 2, the count-lines test, Purchasing's GST test; roleGate 70,
  resetOrder 4, notifications 3.
- Web: stores + purchasing + guards (primaryAction, navigation, boundaries)
  62/63. The one failure is migrationNumbers: "183 for now" leaves a gap the
  master closes by renumbering.
- Opened on fidato_s46 (demo stock loaded):
  - The Inventory Manager at 1280: the tiles (Below level 1, Received, Issued
    and Wasted today 1 each, Not counted 4).
  - The Days grid, opening on Tue 25, with its footer (received ₹2.5k, issued
    ₹741, wasted ₹185 on the 23rd, occupied rooms).
  - By outlet, sales and % a dash for the Inventory Manager. For the GM after
    one ₹2,160 bill: 741 / 2.2k / 34.3%.
  - Receive: 20 kg at ₹96, 5% filled ₹96.00, not claimable, use by 28 Feb; it
    saved as typed.
  - At 375: the Shelf and Days, no sideways page scroll.
  - Purchasing's delivery: 40 kg x ₹95 x 5% = ₹190.00 filled.
  - The bell: "Crockery in Restaurant: never counted".
  - Script clicks were used where the pane would not draw.

**Left open:**
- `lib/reports.ts` waits for the reports lane's export.
- The import has no crockery column.
- The migration number is the master's at merge.

---

## 2026-09-25/26 · The Store's second part: levels per store, the count sheet, cylinders full and empty (D22-38)

**Asked for:** the master's card, 25 September: D22-38 - par levels per store and
a list of what has fallen below; a count sheet whose differences are movements
with a reason and a person; gas by the cylinder, full and empty (S5, S6). Ask
the owner only what is open, build the smallest version of each on the ledger
already built.

**Decided by the owner on the way** - eight questions, the recommendation taken
on every one; relayed to the master, recorded in cp6 as D25-12 to D25-19
- D25-12 · today's one "Warn me below" per item becomes the **Main store's**
  level; levels are per store; Add an item and the import set the Main store's.
- D25-13 · levels are set by owner, admin, GM, hotel manager, Inventory Manager
  (stock `edit`).
- D25-14 · the below-level list only shows; no purchase request.
- D25-15 · a count locks nothing; a line whose book moved since the sheet opened
  refuses the save and is named.
- D25-16 · the paper is blank; the screen shows the book and the difference once
  a count is typed.
- D25-17 · whoever saves is recorded, with "Count of <store>" and a line's
  reason; a blank line is never a zero.
- D25-18 · an item counted in "cylinder" shows Full and Empty; issue asks the
  empties back, a delivery the empties taken; typed every time, 0 an answer.
- D25-19 · the deposit is typed on the item (on deposit, per cylinder); held and
  in use at the kitchen are derived.

**Shipped** - branch `stores/part-two-25sep`
- `db/migrations/140_store_levels_counts_and_cylinders.sql` - `stock_levels`
  (per item per store, composite key, 112's store check reused, no DELETE, audit
  trigger); the old levels moved to each Main store and the column emptied;
  `app.counted_in_cylinders`; `stock_movements.empty` (receipt, return or
  adjustment only, no cost, only on a cylinder item); `app.stock_on_hand` (both)
  leave empties out, `app.stock_empties` counts them; `app.reverse_stock_movement`
  copies `empty`; the two deposit columns. Same signatures (MEMORY 317).
  Written as 139; renumbered 140 at the last merge (the closed-day lane took 139).
- `api/src/modules/stores/stores.ts` - the list gives `levels`, `lowIn`, and for
  cylinders `empties`, `emptiesByStore`, the deposit, `depositHeld`, `inUse`;
  `PATCH /items/:id` (levels, deposit, `edit`); `POST /counts` (`edit`); a
  cylinder issue needs `emptiesBack`, a receipt `emptiesTaken`; Add an item and
  the import write the Main store's level, `edit` needed for a level; an undo of
  empties is checked against the empties.
- `api/src/roleGate.ts` (shared) - the two new writes listed as the store's own,
  as other lanes did; told to the master.
- `src/modules/stores/pages/Stores.tsx`, `data/stores.ts` - the below-level list,
  levels on each card, Set levels (and deposit), Count a store (print, count,
  save), Full · Empty and the deposit line, the empties fields, the history's
  empties labels.
- Tests: `levelsCountsCylinders.test.ts` (11, new); `stockGrants.test.ts` +3 acts
  for every role (add with a level, set a level, save a count);
  `stores.test.tsx` +4; `db/tests/modules/stores.sql` +17 assertions.
- `MODULE.md` - screens, 9 endpoints, 140, tests, open items, two requests.

**Found**
- **My headless Edge signed into the owner's Microsoft account** (26 Sep), as
  on 25 Sep: a profile folder of its own (`.local/edge-s11`, port 9811) but no
  `--inprivate --disable-sync` - the rule (4cde3f9) reached me after my
  screenshot runs. The profile held one account. Every Edge of mine stopped, the
  folder deleted, the script given both flags; the master told at once.
- **The role gate refuses a new write for everybody** until it is listed in
  `api/src/roleGate.ts` - my PATCH answered "Nobody has been given this yet"
  on the running server. Listed; for the master, since the file is shared.
- **Copying `empty` onto an undo changes no count.** Both sum functions already
  leave an undone row and its undo out, so my first break of it passed the
  suite. The migration's comment claimed more; corrected, and the undo row's
  flag is now tested directly (it is what History reads).
- **"Book" was not the right thing to test for.** With the typed-count gate
  removed, a blank line said "Not a count" instead of showing the book, and my
  first assertion passed. The test now also refuses any status line or book
  figure on a blank sheet, and fails when the book is printed on each line.
- The below list first said "3 items" for 2 items (one low in two stores); it
  counts items now. It first printed "Main store: - cylinder"; it says "none".
- The shared `node_modules` junction means every lane's Vite writes one
  dependency cache: my page loaded blank ("504 Outdated Optimize Dep") while
  another lane's server re-optimised it. Worked around with a config in this
  copy's ignored `.local` giving its own `cacheDir`. For the master's MEMORY.
- On this machine today the API and DB runners finished their tests and then
  sat for many minutes: Postgres had six DROP DATABASE statements from several
  lanes queued behind a slow checkpoint. Stopped my own runs after their result
  was written; some `fidato_test_*` scratch databases from killed runs remain.

**Proved** - this copy, own database `fidato_s11` (API 8829, web 5229), every exit code read
- **The six checks, on the tree with cp6 `659901a` merged in:** `npx tsc -p
  tsconfig.app.json --noEmit` exit 0, no output · `cd api && npx tsc --noEmit`
  exit 0, no output · `npm test` **674 passed, 72 files**, exit 0 · `cd api &&
  npm test` **1,520 passed, 95 files**, exit 0 · `bash db/tests/run.sh` **1,171
  assertions**, exit 0 (stores levels 6, stores cylinders 11) · `bash
  db/tests/rerun.sh` **140 migrations re-runnable**, exit 0.
- An earlier run on cp6 `8ca49fa` (before night-audit's merge): web 670 + 1
  failed (accounting, "Nothing was charged or received" not found; alone 16
  passed), API 1,510 + 4 failed (night-audit, three 20 s timeouts). Neither file
  is this lane's; both clean on the final tree.
- **Each rule fails without it** (one break at a time, restored from the commit):
  a level on a new item allowed for `create` → 1 failed, the kitchen manager's
  (200, not 403); the count's book check off → 1 failed (200, not 409, 2
  corrections written); a cylinder issue without its empties allowed → 1 failed
  (200, not 409); the book printed on every sheet line → 1 failed
  ('…piece · Book 50…' not to match); the Issue dialog not waiting for the
  empties → 1 failed; the undo not copying `empty` → 1 failed, its own
  assertion (see Found for the first try that passed).
- **D25-12 on real data:** in `fidato_s11` before the migration, rice (level 20)
  and towels (12) → after, Main store 20 and 12, the item column empty, 2 audit
  rows; migrated again → still 2 levels.
- **On the screen**, as the Inventory Manager: the below list ("Basmati rice -
  Kitchen store: 8 kg, level 10"); rice issued from the Kitchen store while the
  count sheet was open → Save refused "Basmati rice moved in Kitchen store since
  the count was opened - count it again. Nothing was saved.", only that line
  cleared; counted again with "a sack split" → one adjustment, -1, "Count of
  Kitchen store - a sack split", Test Inventory Manager, the two matching lines
  wrote nothing. LPG: Receive refused without the empties answer, then 3 in;
  Issue 1 with 1 empty back → Full 2 · Empty 1; supplier "took 2" refused
  (1 there). Deposit 5 × ₹1,700 → "₹8,500 held · 2 in use at the kitchen". As
  housekeeping: History only, no Count, no Set levels; History reads "Empties
  back from the kitchen +1 cylinder".
- **Screenshots**, `.local/screenshots/2026-09-25-store-two/` (headless Edge,
  CDP): 01-02 levels, the below list, Full · Empty and the deposit (desktop,
  phone); 03-04 Set levels and deposit; 05-06 Issue asks the empties; 07-09 the
  count sheet before and entered with a difference; 10 the printed paper (blank
  boxes, no book); 11 after saving; 12-13 History showing the count, who and why.

**Left open**
- A delivery through Purchasing does not ask for empties (116's door) - a
  request in `MODULE.md`, for the purchasing lane and the owner.
- Undoing an issue does not undo the empties that came back with it (two rows).
- Empties cannot be moved between stores; the count sheet corrects them.
- No "last counted" date and no monthly reminder (S6) - not asked for.
- `fidato_s11` dropped; the probe rows lived only there.

**Commits:** the two WIP commits and the finishing commit on
`stores/part-two-25sep`.

---

## 2026-09-24 · Every issue says which outlet it went to (D22-20)

**Asked for:** the master, 24 September: finish the helper branch
`stores/issue-outlet-rooms-persist`, stopped on 23 September mid-task, on
`admin/finish-24sep`. **The owner's answer, 24 September:** the person must
choose each time - an outlet, or "Not an outlet" (housekeeping, a floor).

**Shipped**
- `GET /stores` answers `outlets`: the hotel's active till outlets.
- The Issue dialog's "Which outlet" (required, starts on "Choose…"): the
  outlets, then "Not an outlet". Issue stays greyed until one is picked;
  "Not an outlet" is sent as `outletId: null`. Shown only where the hotel has
  an outlet.
- `POST /stores/movements` refuses an issue that does not say where it went
  (where the hotel has an active outlet), another property's outlet (069's
  key is on the id alone - MEMORY 161), and an outlet on anything but an
  issue. The history already named the outlet ("to Fidato Restaurant").
- Every API test that records an issue now says `outletId: null`; the
  `STOPS` outlets the new test makes are switched off after it.

**Proved** (this copy, `fidato_s3`, API 8815, web 5215)
- `api/test/modules/stores/stockPerStore.test.ts` "refuses an issue that does
  not say where it went, and takes \"not an outlet\"" - with the server check
  taken out it fails (200, not 409).
- `stores.test.tsx` "an issue must say where it went" - fails with the
  dialog's check taken out (Issue enabled before a choice); "Not an outlet is
  an answer" - sent as null.
- By hand through the API: an issue with no answer, 409 "Which outlet did it
  go to? Choose Not an outlet for housekeeping or a floor."; with `null`, 200.
- Screens: `.local/screenshots/2026-09-24-admin/` 07 (the dialog, nothing
  chosen, Issue greyed), 08 (Fidato Restaurant chosen), 09 (the history: "to
  Fidato Restaurant", and the not-an-outlet issue with none), desktop and
  phone.

**Left open** - nothing here.

---

## 2026-09-17 (phase 1A, merge 1) · Stock held per store, moves between stores, and the long dash gone

**Asked for:** the master, relaying the owner's third interview: merge cp6, read
`docs/briefs/decisions-2026-09-17.md`, build stock per place, clean the long
dash from this folder (D17-59, D17-60), then crockery (D17-69); migration 112;
tell the master the branch when stock per place is done.

**Decided by the owner on the way** — asked with a recommendation each, all taken
- **Two merges.** This one: stock per store, moves between stores, the dash
  pass — enough for the deploy (D17-61) and Purchasing (D17-67). The next: par
  levels, the count sheet, gas by cylinder. Then crockery.
- **One list, pick a store:** "All stores" shows the total and "Main 30 ·
  Kitchen 8 · Bar -"; one store shows only its own.
- **Which store:** every dialog asks, starting on the picked store, else Main.
- **Moving stock** is `create`: the kitchen manager may.
- Already decided (D17-2, D17-3): stock recorded before sits in the Main store;
  the three stores were made by the master's 104.

**Shipped** — branch `stores/phase-1a`, merged with cp6 `f9e144b`
- `db/migrations/112_stock_held_per_store.sql` — `location_id` on every
  movement, back-filled into the Main store; a movement's store checked to be
  a store at its property, the Main store filled in for a writer that names
  none; `app.main_store`, `app.stock_on_hand(item, store)`,
  `app.transfer_stock`; a move is two halves checked at the end of the
  statement; `app.reverse_stock_movement` undoes in the row's store and both
  halves of a move. 069, 094 and 104 untouched.
- `db/tests/modules/stores.sql` — new, 19 assertions.
- `api/src/modules/stores/stores.ts` — the list returns the stores and
  `byStore`; a movement requires its store, refuses a switched-off store for a
  receipt, checks the store's own on hand; `POST /:code/stores/transfers`; the
  undo checks every store it touches; the history names the store and shows a
  move as one row. The one long dash a person could read ("No unit - forty of
  what?") and the three in refusal sentences are gone.
- `src/modules/stores/data/stores.ts` — stores, `byStore`, `locationId`,
  `moveStock`.
- `src/modules/stores/pages/Stores.tsx` — the Store picker; the per-store line;
  "In Kitchen store"; Which store in every dialog; Move to another store; a
  move in History as one line and its undo; every long dash a person reads
  replaced (" - " in a sentence, "-" for nothing held or set).
- Tests: `stockPerStore.test.ts` (11), the three store server tests updated
  (every movement names its store; every role tries a move), `stores.test.tsx`
  (per-store line, picking a store, no long dash).
- `MODULE.md` — the screen, 7 endpoints, 106, the tests.

**Found**
- **A deferred check blocks ALTER TABLE.** My first version of the two-halves
  rule was a deferred constraint trigger. Postgres then refuses ALTER TABLE on
  the table in any transaction with a stock insert ("pending trigger events"),
  and the frozen `suite.sql` lifts the append-only guard to clean up — it
  stopped there. Replaced by a statement-level check, which is enough because
  both writers put every half in one statement. For the master's root
  `MEMORY.md`: a deferred constraint trigger queues an event for every row it
  watches, and any later ALTER TABLE in that transaction fails.
- **Two writers name no store:** the frozen `suite.sql` and the master's
  `shared.sql`. Neither is this lane's; the database gives them the Main store,
  D17-2's own rule, while the API refuses a request that names none.
- **A break that tested two things at once** (MEMORY 270's shape): removing the
  store trigger also removed the Main-store default, so the suite stopped for a
  reason that was not the rule. Redone one rule at a time.
- **The order of the stores** first read "Main · Bar · Kitchen" (alphabetical);
  the owner's approved layout reads "Main · Kitchen · Bar". Ordered by the
  owner's names (D17-3), then by name.
- A dialog said "0 piece in Kitchen store" beside a store the list shows as
  "-": it now says "None in Kitchen store".

**Proved** — in `D:\fidato-stores`, every exit code read
- Database: `bash db/tests/run.sh` **806 assertions**, exit 0 (19 new);
  `bash db/tests/rerun.sh` **106 migrations re-runnable**, exit 0. Breaks: the
  two-halves check removed → 4 failed (three its own, one knock-on); the
  store-at-this-property check removed → 2 failed, exactly its own.
- The back-fill on real data, `fidato_stores`: 14 movements → all in Main
  store, 14 audit rows; migrated again → nothing added.
- Server: `npm test -- test/modules/stores` **181 passed**. Breaks: the issue
  check read the hotel's total → 1 failed ("more than THAT store holds"); the
  move route asked `view` → 4 failed, exactly the look-only roles; the history
  showed both halves → 1 failed.
- Web: a long dash put back in a dialog title → the D17-48 test failed
  ("expected 'Receive — Bath towel…' not to contain '—'").
- On the screen, own database, as `dev-store`: picker All / Main / Kitchen /
  Bar; received 10 towels into the Kitchen store → "Main 3 · Kitchen 10 ·
  Bar -", average ₹231; moved 2 Main → Kitchen → "Main 1 · Kitchen 12", total
  13; History "Moved from Main store to Kitchen store 2 piece"; undo asked "It
  goes back from Kitchen store to Main store", then "Undo of a move" and "Main
  3 · Kitchen 10". At 375px: no sideways scroll, nothing outside, 0 controls
  under 44px, 0 unnamed buttons, 0 contrast failures, buttons on one row, no
  long dash; cards 234–290px (the store line adds a row). As `dev-hk`: the
  picker, the store line, History only, the look-only sentence.
- Gates: `npx tsc -b --force` exit 0 · `npx vitest run` **347 passed**, exit 0
  · `cd api; npm test` **933 passed, 53 files**, exit 0 · `npm run
  strip-check` 81 files, exit 0 · `npm run build` exit 0, "no test sign-in in
  dist".

**Left open**
- Merge 2, straight after: par levels per store, the count sheet, gas by
  cylinder (D17-4: the refill price per full cylinder received, and the
  deposit held on each cylinder tracked). Then phase 2A, crockery and cutlery.
- The low-stock warning still reads the hotel's total per item — par levels per
  store (merge 2) replace it.
- The markdown papers in this folder keep their long dashes: they are notes for
  the next chat, not screens.
- `fidato_stores` (development only): towels received into the Kitchen store,
  a move and its undo.

**Commits:** the stock-per-store commit on `stores/phase-1a`.

---

## 2026-09-16 (phase 1A, part 2) · STO-2 to STO-11: the Store's screen, fixed as the owner chose

**Asked for:** the master, after merging STO-1: merge cp6, re-read the brief,
continue with STO-2 to STO-10; the owner had answered STO-4 (the Inventory
Manager sees who moved stock). The brief also renamed the role **Inventory
Manager** (key `stores`) and gave `app.colleague_name` (096).

**Decided by the owner on the way** — asked with a recommendation each; every
recommendation taken
- STO-3: the name on its own line on a phone.
- STO-5 and 7: Receive · Issue · More (Waste, Return to supplier, Correct the
  count, History).
- STO-6: Undo asks first, and an undo row names what it undid.
- STO-8: "Add an item" is the main action; buttons say what will happen.
- STO-10: "Where it belongs" starts on nothing; units stay as typed.
- **STO-11, new:** refuse an undo that would leave the shelf below zero, and
  say why.
- STO-2 needed no question: it follows the failed-read pattern the till
  (POS-4) and Rooms already use, words included.

**Shipped** — branch `stores/phase-1a`, merged with cp6 `eaf6916`; no migration
- `api/src/modules/stores/stores.ts` — history names for the Inventory Manager
  via `app.colleague_name`; `reversesKind` on an undo; the undo route refuses
  below zero; refusal words say "Inventory Manager" and "correct the count".
- `api/src/modules/stores/stockGrants.ts` — `isInventoryManagerAt`; the
  refusal sentences' role name.
- `src/modules/stores/data/stores.ts` — the reads throw; `reversesKind`.
- `src/modules/stores/pages/Stores.tsx` — four states; the new card; More;
  Correct the count (counts the shelf, records the difference); Return to
  supplier; the undo confirmation and "Undo of a …"; the primary action and
  verb buttons; the category must be chosen; the look-only and undo sentences
  name the Inventory Manager; a truthful cost hint.
- Tests: `api/test/modules/stores/historyNames.test.ts` (5),
  `api/test/modules/stores/undoBelowZero.test.ts` (3),
  `src/modules/stores/stores.test.tsx` (7), `src/modules/stores/data/stores.test.ts` (2).
- `DEFECTS.md` — STO-2 to STO-8, STO-10 and STO-11 to Fixed; STO-9 stays open,
  the master's. `MODULE.md` — the page, the endpoints, names, the tests.

**Found**
- **STO-11** — see above; found on screen, on my own STO-1 probe data.
- **The fix for STO-3 was undone at a tablet's width** before anybody saw it:
  at 1025px the buttons joined the name's row and squeezed it to 115–121px.
  They now join only from `xl`. And at 375px More wrapped (305px needed, 294
  given), so the arrows show from `sm` up.
- **The receipt's cost hint was wrong even with an Adjust button:** an
  adjustment carries no cost. It now says a cost can only be added by undoing
  the delivery and receiving it again.
- **A deliberate break that did not apply** (MEMORY 270's shape): my first
  put-back of `catch { return [] }` matched nothing — the file has CRLF line
  endings — and the test passed. Seen from the match count (0), redone, and
  then it failed as it should.
- **Once, the web suite went red on a file not in this lane:**
  `night-audit/nightAudit.test.tsx` "sends the day it shows…" could not find
  "Run night audit" while the API suite was running beside it. Alone it
  passed; the whole suite re-run on a quiet machine passed. For the master:
  it may time out under load.

**Proved** — in `D:\fidato-stores`, every exit code read
- Server: `npm test -- test/modules/stores` **156 passed**. Breaks: names given
  to nobody → 1 failed (the Inventory Manager's); to everybody → 2 failed
  (housekeeping's, the kitchen manager's); the below-zero check removed → 1
  failed ("expected 200 to be 409"). All restored.
- Web: `data/stores.test.ts` with the swallow put back → 1 failed;
  `stores.test.tsx` with one-tap undo → 1 failed; with the Kitchen default → 6
  failed, the first "expected 'Kitchen' to be ''" and five after it for that
  test's reason. All restored; 9 passed.
- On the screen, own database, as `dev-store`: at 375 and 360px every card's
  buttons on one row, 0 controls under 44px, 0 unnamed buttons, 0 contrast
  failures, no sideways scroll; names on one line at 375, 768, 1025 and 1280;
  Correct the count took rice from −12 to 0; History names Test Viewer, Test
  Housekeeping, Test Reception; "Undo of a delivery"; undoing LPG's delivery
  asked, then showed "Not undone — Undoing this delivery would leave −2
  cylinder…", the server answering 409.
- Gates: `npx tsc -b --force` exit 0 · `npx vitest run` **265 passed**, exit 0
  (the re-run above) · `cd api; npm test` **603 passed, 38 files**, exit 0 ·
  `npm run strip-check` 72 files, exit 0 · `bash db/tests/run.sh` **664
  assertions**, exit 0 · `npm run build` exit 0, "no test sign-in in dist".

**Left open**
- STO-9 — the shared kit's, requested of the master in `MODULE.md`.
- Phase 1A's next items (brief § 3–6): stock per location, par levels, the
  count sheet, gas by cylinder — with the owner's questions on where existing
  stock goes and how a cylinder is priced. Migration number 097 when written.
- For the master, root `MEMORY.md`: "a layout fixed at one width is measured
  either side of every breakpoint it uses" (STO-3).

**Commits:** the STO-2..11 commit on `stores/phase-1a`.

---

## 2026-09-16 (phase 1A, part 1) · STO-1 closed: the Store asks who you are

**Asked for:** the owner: merge cp6, then follow `docs/briefs/stores.md` —
phase 1A of `docs/STOCK-AND-EQUIPMENT-PLAN.md`, STO-1 first.

**Decided by the owner on the way** (asked with a recommendation, both taken)
- **Import is split by row:** a new item needs `create`; a row that changes an
  existing item needs `edit`, and without it is rejected, not applied.
- **Look-only people get one sentence and no change buttons**, not greyed
  buttons on every item — an exception to "greyed with its reason".

**Shipped** — branch `stores/phase-1a`, from cp6 `4bc68dd`
- `api/src/modules/stores/stockGrants.ts` — the server's copy of
  `grantsFor(role, "stock")`, and `mayStock()`. All six routes in `stores.ts`
  ask it before their first write and answer 403 with who may.
- "Add an item" with a name already in the store needs `edit` too: its insert
  overwrites that item's unit, category and warning level — the same change
  the owner put behind `edit` for an import.
- `routes.tsx` — `RequireAccess` on `/h/:code/stores`, resource `stock`.
- `pages/Stores.tsx` — the look-only sentence; change buttons only with
  `create`; Undo only with `edit`, and otherwise a sentence in History saying
  who may (the owner's answer applied to Undo — told to them).
- `api/test/modules/stores/stockGrants.test.ts` — new, 148 tests.
- `DEFECTS.md` — STO-1 to Fixed, with the proof. `MODULE.md` — grants per
  endpoint, who sees what, the claim command, the migration rule, the
  withSession check, and STO-9 as a request to the master.

**Found**
- The import route treated a name already in the store as an update without
  asking anything — and so did "Add an item" (its `on conflict do update`).
  Both are now `edit`.
- In a worktree the dev server answers **403 for the Inter font files**
  (`/@fs/D:/fidato pms/node_modules/@fontsource-variable/…`): the linked
  `node_modules` resolves outside the copy's root, and Vite refuses to serve
  it. Every lane copy will show two console errors for it. Harmless in the
  build; for the master.

**Proved** — in `D:\fidato-stores`, 16 September, every exit code read
- `stockGrants.test.ts`: **148 passed**. Guard taken out (`mayStock` returns
  true): **78 failed**, exactly the expected refusals. `front_desk` put into
  the server's `create` list: **9 failed**, the copy check among them. Both
  breaks removed; 148 passed.
- In the browser, own database: reception refused the page; the Viewer sees
  11 items, History only, the sentence, no Undo; the kitchen manager sees
  Receive, Issue, the bin, Add and Import and no Undo. The running API as five
  roles: `desk 403/403/403 · viewer 200/403/403 · hk 200/403/403 · kitchen
  200/200/403 · store 200/200/200` (list / add / undo).
- Gates: `npx tsc -b --force` exit 0 · `npx vitest run` **255 passed**, exit 0
  · `cd api; npm test` **573 passed, 35 files**, exit 0 · `npm run
  strip-check` 72 files, exit 0 · `bash db/tests/run.sh` **648 assertions**,
  exit 0 · `npm run build` exit 0, "no test sign-in in dist".

**Left open**
- STO-2 to STO-10 — next; the owner chooses where an entry leaves more than
  one way.
- `fidato_stores` (development only): the store tester's probe undid movement
  1 (the first rice delivery) while proving the running API; a kitchen manager
  tester `dev-kitchen` was added.

**Commits:** the STO-1 commit on `stores/phase-1a`.

---

## 2026-09-16 · the Store measured at 375px as housekeeping

**Asked for:** the owner opened a Store chat: "Read docs/briefs/stores.md and
follow it exactly", and asked which screens this lane may edit and what is
under it. The brief's job: measure the screen at 375px as a housekeeping role,
write what is found as STO-1 onwards, bring the owner the list, fix nothing.

**Shipped**
- `DEFECTS.md` — **STO-1 to STO-10**, each with its evidence. No code changed.
- The claim: first `.claims/stores.md` in this copy (the old design), then
  moved on the master's instruction to `scripts/claim.mjs` in the shared git
  directory; the file was deleted and never committed.

**Found** — the headline three; the rest are in `DEFECTS.md`
- **STO-1**: no store route checks the caller's role. As the **Viewer**
  (`read_only`, "No write access anywhere") the API accepted a new item, a
  receipt at a cost, an undo of a real delivery and an import; reception and
  housekeeping likewise. The screen offers the Viewer every button.
- **STO-2**: with the API stopped, a store of 9 items read "Nothing in the
  store yet — Add the first".
- **STO-3**: at 375px the item name gets 69–86px; one card is 480px tall; 9
  items are 3,122px of scrolling.
- Passed, and recorded so nobody measures it again: no sideways scroll, nothing
  outside the viewport, 0 list controls under 44px, 0 text under 4.5:1.

**Found about the lane recipe** (not this service's; for the master, root
`MEMORY.md`)
- `docs/briefs/README.md`'s `DB=… ./db/migrate.sh --with-dev-identities` does
  not give a database anybody can sign in to. `dev-identities.sql` raised
  "expected 3 staff with dev uids, found 0" and `migrate.sh` then printed
  **"✓ local sign-in accounts linked"** (MEMORY 274's shape). `load-demo.ts`
  fails on a fresh database ("Cannot read properties of undefined (reading
  'id')") because it needs `owner@` and `agra@fidato.in`, which only
  `db/tests/suite.sql` creates. Worked around by inserting those three staff
  rows as `suite.sql` does, into `fidato_stores` only.
- The first `migrate.sh` run on the new database printed "the migration run
  failed and was ROLLED BACK" with no error line in its tail; the second run
  applied 90 migrations cleanly. Not reproduced.
- `load-demo.ts` defaults to `postgres://…/fidato` when `SUPER_DATABASE_URL`
  is unset — a lane that follows the brief and runs it lands in the shared
  development database.

**Proved** — in this copy, 16 September
- Servers from this copy only: API on 8796 against `fidato_stores`
  (`/health`: database reachable, role `pms_app`), web on 5196.
- Every figure in `DEFECTS.md` was measured in the browser at 375×812 with a
  DOM script (computed contrast against the actual background, bounding
  boxes, accessible names), or taken from the API responses quoted there.
- `.claude/launch.json` carried two local entries (`stores-api`,
  `stores-web`) for the preview pane; restored before commit.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed, exit 0.
  `npm run lane -- stores`: 2 files, both yours, exit 0.
- Not run: `tsc`, the full web, API and database suites, the build — only
  Markdown in this service's folder changed.

**Left open**
- All ten STO entries — the owner's choice, in the list brought to them.
- STO-9 is the shared kit's (`src/components/ui/`) — the master's.
- `fidato_stores` holds the probe rows from STO-1 (append-only, so they stay).

**Commits:** this entry and `DEFECTS.md`, on `stores/measure-375`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the Store entry, in the housekeeping and
  store roles' menus; `routes.tsx`; `index.ts`; a first `MODULE.md`; and
  `api/src/modules/stores/index.ts`, which mounts `stores.ts`.
- Step 4 (`cddb5f4`): moved in — `pages/Stores.tsx` (from `src/pages/`) and
  `data/stores.ts` (from `src/data/repositories/`). Nothing else used them.
- `e754c49`: `data/stores.ts` takes the business date from the core.
- This brief: `MODULE.md` rewritten from the code — one screen, 6 endpoints,
  two tables, the rules; this file; `DEFECTS.md` indexing four root entries.

**Found** (while writing the brief; nothing numbered)
- No file in `api/test/` touches the store's routes.
- The Store screen never sends the outlet an issue went to, though the column
  and the API take one.

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
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- The server code is still in `api/src/routes/stores.ts`; moving it into
  `api/src/modules/stores/` is step 5, in progress elsewhere.
- `db/tests/modules/stores.sql` does not exist yet.
- Purchase and expense approvals — the owner's decision (PENDING § 4).

**Commits:** `e9dd6b1` · `cddb5f4` · `e754c49`, and the commit that added
this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 3) · A menu for each person, and the search it depends on

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 18, "The store, and a way through") are the record.
