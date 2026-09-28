# Housekeeping — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-28 · "The buttons are not working" - HK-12, HK-13, HK-14

**Asked for:** the owner, 28 September: "check housekeeping because the
buttons are not working in that. I tried to click inspect and that thing is
not working." Seen on the redesign's local copy, as the owner, desk and phone.
Branch `housekeeping/buttons-28sep`, from `cp6` at `5527ab5`.

**Found** - every button on Housekeeping and Work orders pressed as the owner,
Housekeeping, the Hotel Manager and the GM, at 1280 and 390 wide:
- **HK-12** - Inspected WAS saved (PUT 200, ~30 ms); nothing said so, and the
  card waited 1.2 s for every query in the app before it moved - meanwhile
  saying "needs cleaning first" of a room just cleaned. Live code the same.
- **HK-13** - the six counts at the top (the redesign's head) looked like the
  Dashboard's and did nothing.
- **HK-14** - a Hotel Manager could give rooms to nobody but themselves, and
  saw every room as Unassigned; a housekeeper saw only themselves. Row
  security on `staff_hotels`, which 027's colleague rule never got past.
  Live code the same.
- Clean, Repair, Put back, the name chips, Raise one, Start, Put back, Close,
  Costs and the Open · Closed switch all worked for every role tried.

**Shipped** (the owner's answers, 28 September):
- A marked room moves at once and says "Room 210 is inspected." / "... is clean."
- A count jumps to its group, with an arrow; Due out and a zero stay flat.
- Migration **who works here** (149): `app.hotel_people`, names and roles of
  the people at a hotel the caller works at; the three housekeeping reads use
  it. The tables' own rules are unchanged.

**Proved** - `bash scripts/gates.sh housekeeping-fix`, exit 0 (1243 s): web
types 0, api types 0, strip 0 (147 files), web tests 729 passed / 88 files,
api tests 1628 passed / 103 files, database 1225 assertions (149 migrations),
replay 149 re-runnable. Seen failing without the fix: the two page tests (2
failed, exit 1), "moves the room the moment it is marked" with only the cache
write removed (1 failed), `roster.test.ts` on the old routes (2 failed, exit 1).
Screens: owner at 1280 and 390 (message, jump); Housekeeping at 390 (Clean
then Inspected at once, assign, Repair, Work orders Start, Put back, Close);
Hotel Manager at 1280 (every person listed, room 304 given out, Raise one,
Start); GM at 390 (Inspected, Close). Dialog fields filled through the page
where the hidden pane froze them.

**Left open** - the same staff read in `finance/cashier.ts` and `pos/till.ts`
(the master's); an assignment PUT seen once to hang, not reproduced.

---

## 2026-09-26 · HK-1: the board's own half held by a test

**Asked for:** the owner's D25-27 (a test for each fix built but held by none, then close it; no behaviour changed), in the five-tests session, branch `tests/five-25sep`. **Shipped:** `housekeeping.test.tsx`, "reads the rooms again the moment the live channel says housekeeping" (the stream stubbed, one `changed` frame). **Proved:** seen failing with `useLive` taken off the board; passes on the fix. HK-1 moved to Fixed. **Left open:** nothing here. **Commits:** `689f837`.

---

## 2026-09-25 · Two unused GST columns out of the room status routes — HK-11

**Asked for:** the master, branch `fixes/billtab-date-25sep`: C -
`roomStatus.ts` selected `hotels.cgst_rate` and `sgst_rate`, typed `string`
(nullable since 136), and used neither.

**Shipped** - both out of `resolve`'s query and `HotelRow`. No test:
nothing read them; `cd api && npx tsc --noEmit` exit 0 proves nothing does.

**Proved / commits** - with the channel manager's entry of today (the same
branch's six checks); `4e8722d`, `696b563`.

---

## 2026-09-17 (evening) · The board refreshes itself — HK-1, half live

**Asked for:** the owner's second interview, 17 September (D17-39): HK-1, the
housekeeping board refreshes itself when a room changes, the way Tables and the
Kitchen already do; if that needs the shared live channel changed, a request to
the master. D17-40: the assignee dropdown stays as it is. (D17-38 confirmed the
refusal on closing a repair while its item waits, as built.)

**Shipped** — branch `housekeeping/live-board`, from `cp6` at `766566b`:
- **`db/migrations/103_housekeeping_changes_are_announced.sql`** — triggers on
  `rooms` (cleaning state, occupancy), `room_blocks`, `housekeeping_assignments`
  and `work_orders` raise `<hotel id>:housekeeping` on the live channel. Safe
  alone: today's listener finds no watcher for that payload.
- **The board polls every 30 seconds** (its rooms, the sheet, the blocks — not
  the roster), as Tables does; not in the background.
- **The board keeps its rooms when a poll fails** (HK-10): the error state is
  drawn only when there is nothing to show.
- **The request to the master** (`MODULE.md` → Requests from this service): a
  topic on the shared channel — `realtime.ts`, `live.ts`, `useLiveOrders.ts`,
  `api/test/live.test.ts` — and the board's wiring once it lands.
- Nothing about the assignee dropdown changed (D17-40).

**Found** — HK-1's "known and small" fix is small, but two of its three halves
are the core's (`DEFECTS.md` HK-1). HK-10, prevented before it shipped: React
Query keeps data on a failed refetch and still reports the error, so a polling
board would have swapped eighteen cached rooms for "did not load".

**Proved** — on this tree, 17 September:
- In the browser, signed in as the owner: room 210 changed from outside the
  browser appeared under Needs cleaning without a reload; room 208 changed the
  same way moved **21.5 s** later (the pane was hidden, so React Query's focus
  was set by hand for the measurement — a hidden page does not poll, by
  design). API stopped: a poll failed with `ERR_CONNECTION_REFUSED`, the 18
  rooms stayed, the line said Offline.
- `api/test/modules/housekeeping/live.test.ts`: 5 passed; with the payload made a
  bare hotel id, **5 failed**; restored.
- `housekeeping.test.tsx`: 9 passed; with the old error condition, and
  separately with no poll, the refresh test **failed** each time; restored.
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0.
- `npx vitest run`: **329 passed, 35 files, exit 0**.
- `cd api && npm test`: **878 passed, 48 files, exit 0** (the exit code written
  to the log this time, not read through a pipe).
- `bash db/tests/run.sh`: **785 assertions passed**, exit 0 · `bash
  db/tests/rerun.sh`: **103 migrations re-runnable**, exit 0.
- `npm run build`: exit 0, "no test sign-in in dist".

**Left open**
- **Told the moment a room changes** — waits on the master's change to the live
  channel; then the board's few lines of wiring (the request says which).
- The requests from the earlier session (Start here words, `ROOM_TONES`,
  `migrate.sh`) — still listed.

**Commits:** on branch `housekeeping/live-board`.

---

## 2026-09-17 · Words on the room card, and repairs on equipment (phase 2B)

**Asked for:** the housekeeping brief's first task (the critique's P3: three
icons, two silently disabled), then the owner's answers of 17 September —
D17-8 ("Clean", "Inspected", "Repair" under the icons; a greyed one says why
when tapped), D17-9 (no Needs cleaning section) and phase 2B of
`docs/STOCK-AND-EQUIPMENT-PLAN.md` with D17-5, D17-6 and D17-7. Nine further
questions were put to the owner the same morning, each with a recommendation;
every recommendation was taken (`MODULE.md` → Rules).

**Shipped**
- **The room card** (`pages/Housekeeping.tsx`): Clean · Inspected · Repair,
  each a word under its icon, 98×56 at 375px; a grey one is `aria-disabled` and
  says why in the card on a tap; an out-of-service room says **Put back**.
- **Report a repair** (`flows/RepairFlow.tsx`): one dialog for the board, Work
  orders and an equipment item's page — optional tagged equipment, and taking
  the room out of service as a second, unticked choice that links the block.
- **Work orders** (`pages/WorkOrders.tsx`): Open · Closed; each order names its
  equipment and, for those who may see money, its cost; four list states.
- **Costs** (`flows/RepairCosts.tsx`, `api/src/modules/housekeeping/repairs.ts`):
  record with proof, see the proof, cancel with a reason.
- **The item's repairs** (`components/ItemRepairs.tsx`, exported from `index.ts`).
- **Migration `102_repairs_on_equipment.sql`** — `work_orders.equipment_item_id`
  (tagged, same property, fixed once raised) and `work_order_costs` (proof
  required and its own, never edited, cancelled once, no delete, RLS forced).
- **Who may** — `repairRoles.ts`, web and server copies held together by test.
- **Outside this folder, on the owner's yes, for the master's review:**
  `api/src/modules/equipment/repairs.ts` + three exports in its `index.ts` (the
  door D17-7 goes through), and `src/modules/equipment/pages/EquipmentItem.tsx`
  (renders the Repairs section).

**Found** — `DEFECTS.md` HK-3 to HK-9. Two fixed that nobody had asked about
(HK-4 a failure read as "nothing outstanding", HK-5 a closed repair re-closed
over its closer), one prevented before it shipped (HK-6), one trap avoided
(HK-8), one of mine (HK-9). The critique's "no Needs cleaning section" is half
right: the group exists and hides when empty — the owner said not to build one.

**Proved** — on this tree, 17 September, in `D:\fidato-housekeeping`:
- At 375px, before: three 44×44 icons, no words, disabled ones silent. After:
  18 cards, Clean · Inspected · Repair at 98×56, 0 controls under 44px, no
  sideways scroll, no label wraps; a grey tap wrote "Room 209 needs cleaning
  first." and sent no request. Report a repair raised on 209's AC from the
  board → the AC read `under_repair` with "Repair raised: AC not cooling" in its
  history; a cost of ₹1,850 recorded through the screen with a PNG, the proof
  opened as `image/png`; closed as Fixed → `in_use`, "Repair closed: …"; the
  Closed list and the item page both show it. Console clean.
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0.
- `npx vitest run`: first run 2 failed (night audit's known timing test, and
  front desk's `stayViewStates` file) — both passed alone (3/3); second full run
  **276 passed, 29 files, exit 0**.
- `cd api && npm test -- modules/housekeeping`: 45 passed, exit 0. With three
  guards broken on purpose (the cost role check, the automatic Under repair, the
  inbox refusal): **19 failed**, each on its own rule; restored.
- Web: with the grey-tap sentence and the old swallowing catch put back, 2 of
  the 7 new tests failed; restored.
- `bash db/tests/run.sh`: **754 assertions passed**, 18 of them new, exit 0.
- `bash db/tests/rerun.sh`: **99 migrations re-runnable**, exit 0.
- `npm run build`: exit 0, "no test sign-in in dist".
- The full `cd api && npm test`: **801 passed, 40 files**, no unhandled-error
  line, in 278 s. Its exit code was masked — I piped it through `tail` — so
  the summary is the evidence here, not the exit code.

**Left open**
- HK-1, the board's refresh — deferred by the owner; paired with the master.
- Closing a repair on a thing waiting in the approvals inbox is refused — the
  owner's rule for raising, applied to closing; the owner may want otherwise.
- The master's review of the two equipment files; the requests in `MODULE.md`
  (Start here words, `ROOM_TONES`, `migrate.sh`).
- The assignee picker in every card (the critique's second P3) — not touched;
  it changes how work is handed out, and nobody has asked the owner yet.
- The "Test GM" chips — not checked against production.

**Commits:** on branch `housekeeping/room-card-labels`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/housekeeping/index.ts`, at first mounting
  `api/src/routes/housekeeping.ts`.
- Step 4a (`23cd2e4`): the board, whose rooms are whose, and work orders
  were cut out of `operations.ts` into their own `housekeeping.ts`, in place.
- Step 4 (`b06ce9e`), moved into this folder:
  - pages — `Housekeeping.tsx`, `WorkOrders.tsx` (from `src/pages/`)
  - flow — `OutOfOrderFlow.tsx` (from `src/components/flows/`)
  - data — `housekeeping.ts` (from `src/data/repositories/`)
- Step 5, the server (`3ca215d`): `housekeeping.ts` moved to
  `api/src/modules/housekeeping/`, and room status and blocks were cut out
  of the core's `property.ts` into `roomStatus.ts`.
- `11d77a3`: the board catches a device with no offline store instead of
  leaving an uncaught error (root MEMORY 274).
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- Nothing new. Noted in the brief: room status and blocks are still called
  from the core's `src/data/repositories/rooms.ts`, while their endpoints
  now live here.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- Defect 218, the board's missing refresh — deferred by the owner.

**Commits:** `e9dd6b1`, `23cd2e4`, `b06ce9e`, `3ca215d`, `11d77a3`, and the
commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
