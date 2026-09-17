# Changelog — the restaurant (POS)

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-17 (evening) · D17-21, the till's half — restaurant food on a banquet function's bill

**Asked for:** the owner's D17-21 — *"the POS chat then lets staff attach an
order to one of those functions when ordering (`pos_orders.event_id` exists).
Banquet goes first."* The banquet chat committed its half (`f16a1bd`) during
the day. The owner's answers the same afternoon: **build on banquet's commit**
(its branch alone leaves Rule 2b red until the till calls its door); attach on
**Tables, the Terminal and the Till**; an attached order is **paid on the
function's bill only**, recorded as a new payment **"To a function"**.

**Shipped** — branch `pos/d17-slip-addons-dates`, banquet's `f16a1bd` merged in
(`30a8d3a`).
- `db/migrations/099_pos_settled_to_a_function.sql` — payment method
  `function` on orders and payment rows, and a bill settled to a function must
  name one. Replay-guarded (MEMORY 284). **Number 099 is also the night-audit
  chat's**; the master renumbers at merge.
- `api/src/modules/pos/till.ts` — the order header and the pad's round take
  `eventId`; the server asks banquet's `whyNotAttachable` (its front door)
  before writing, and again before settling to the function; cash, card, UPI, a
  room and a split are refused for an order on a function, with the function's
  name; settling to it writes nothing to a folio; `readOrder` returns
  `eventId` and `eventTitle`.
- `components/FunctionPicker.tsx` — "Banquet function", banquet's list through
  `@/modules/banquet`; not drawn where there is nothing to choose. On Tables'
  pad (sent with the round), the Terminal's order and the Till's order.
- The Terminal and the Till — an order on a function offers **Charge to
  {function}** and shows room, cash, card, UPI (and on the Till, Part)
  switched off with the reason. A settled one reads "On {function}'s bill".
  The printed bill says "Charged to {function}'s bill". Close restaurant day
  lists "To a function", and says it is not in the tin.
- Tests: `api/test/modules/pos/functionOrders.test.ts` (8), `src/modules/pos/
  functionOrders.test.tsx` (8), `db/tests/modules/pos.sql` (new, 8).
- `MODULE.md` (endpoints, the picker, 099, banquet's door under "Leans on",
  the rule), `DEFECTS.md` (POS-13).

**Found**
- **Why the payment question had to be asked:** `app.banquet_event_total` (061)
  counts every settled order on a function whatever its method — cash at the
  till would have been billed to the host as well.
- **POS-13, mine, before commit:** the first database check, with the
  constraint taken out, did not fail by name — its clean-up could not remove a
  settled order's payment and the suite stopped. Rewritten to undo the attempt;
  it now fails by name.

**Proved** — this copy, after the last code edit
- Web: `npx tsc -b --force` exit 0. `npx vitest run` three runs on this tree:
  **302 of 303, exit 1** twice — each time `nightAudit.test.tsx` "sends the day
  it shows" (its one-second wait, the night-audit chat's to fix; alone: 1
  passed, exit 0); and **286 passed, exit 1** once, with `repositories.test.ts`
  failing as a file — its error not captured; alone it passed 17 of 17 (Rule 2b
  included), and it passed in both other runs. **No full web run on this tree
  exited 0.** `npm run build` clean, "no test sign-in in dist".
- API: `npx tsc --noEmit` exit 0 · strip-check 76 files · `npm test` **42
  files, 773 tests, exit 0**.
- Database: `db/tests/run.sh` **744 assertions, exit 0** (pos function 8 of 8) ·
  `db/tests/rerun.sh` all 99 re-runnable, exit 0.
- Guards against the faults put back: the server's four refusals removed → 4
  of 8 failed (the cash one now on "the order was settled anyway"); six screen
  faults → 7 of 8 failed; the constraint removed → "a bill settled to a function
  with no function is refused | it was allowed". Each restored and green.
- **Opened**, as the owner, API 8795 on `fidato_pos` (banquet switched on there,
  a hall "Lawn", "Sharma wedding" confirmed for 25 August 18:00–23:30):
  Tables AC6 — "Banquet function" offered Sharma wedding, chosen, Paneer
  Butter Masala sent; the order written on the function. The Till — "Charge to
  Sharma wedding" the one primary action, room/cash/card/UPI/Part off, the
  reason; pressed → 200, "Settled today · function · ₹357". Banquet's page for
  Sharma wedding — "Restaurant orders ₹357", "20260825-7 · Settled · Table
  AC6"; total a dash (the hall is unpriced). Database: `pos_amount` 357 once, a
  `function` payment row, no folio posting. Close restaurant day — "To a
  function ₹357". The Terminal — a new order put on the function: the same
  offer and the same switched-off buttons.

**Left open**
- A function chosen on Tables is not kept in the pad's saved draft (the draft's
  shape is the core's); close the pad before Send and the choice goes.
- Settling to a function with the line down gets the shared offline sentence
  "…unless it is charged to a room" (`@/lib/offline.ts`, the core's).
- The Till's list of today's bills reads "· function", as it reads "· cash".
- **For the master:** merge banquet (`f16a1bd`) before this branch — it is in
  this branch already; renumber 099 against night audit's; the root MEMORY
  lessons from POS-8 and POS-13.

**Commits:** the commit that adds this entry.

---

## 2026-09-17 (later) · The owner's four answers: a blocked slip, the Menu on a phone, a table on the slip, how function food is paid

**Asked for:** after `50080a0` the owner answered what that entry left open,
each on the recommendation: **POS-10** — say so when the browser refuses the
slip, with a button, as a notice on the screen (not in the pop-up, which has
no button and is gone in 4.5 seconds); **POS-9** — wrap the Menu's dish rows
on a phone; **POS-12**, found on screen after it — copy the table's name onto
orders taken on Tables, no back-fill; and for **D17-21** — an order attached to
a banquet function is paid on the function's bill only.

**Shipped**
- `components/SlipNotice.tsx` (new), `pages/Floor.tsx`, `pages/Terminal.tsx`,
  `flows/OrderPad.tsx` — a refused slip becomes a line on Tables or the
  Terminal: "Order 4 for AC4 is with the kitchen, but its slip did not open —
  the browser blocked the new tab." · **Open the kitchen slip** · close. One per
  slip; refused again, it says to allow pop-ups.
- `flows/OrderPad.tsx` — the sent round leaves the device BEFORE the slip opens
  (POS-11, below).
- `pages/Menu.tsx` — a dish row's controls go under the name when the row is
  too narrow; unchanged at a desk.
- `api/src/modules/pos/till.ts` — the order pad's route copies the table's
  name into `table_ref`, as opening one order does. **A server change**, the
  batch route only; no migration.
- Tests: `ownerDecisions.test.tsx` 9 → 15; `api/test/modules/pos/tillBatch.test.ts`
  4 → 5.
- `DEFECTS.md` — POS-9, 10 fixed; POS-11 (mine) and POS-12 added and fixed;
  nothing open. `MODULE.md` — the notice, and D17-21's answer.

**Found**
- **POS-11, mine, from `50080a0`:** the slip opened before the pad cleared the
  saved round. In the preview pane the new tab replaced the page, and AC1 read
  "not sent" with a dish already at the kitchen still on its pad — one Send
  from cooking and billing it twice. Fixed; see `DEFECTS.md`.
- **My first POS-11 test passed with the fault put back** — the pad clears an
  empty draft by itself as it opens, and the test counted that. Rewritten; it
  fails on the fault now.
- **POS-12:** the order pad's route never wrote `table_ref`, so every slip,
  bill and Terminal line for an order taken on Tables had no table, since
  8 September.
- **My own slip on screen:** a script that was meant to hand the page its real
  `window.open` back handed it nothing, and the notice's button threw "window.open
  is not a function". The test rig's fault, not the screen's; redone on AC4
  with the real one kept.

**Proved** — this copy, after the last code edit, one gate after another
- `npx tsc -b --force` exit 0 · `npx vitest run` **29 files, 284 tests, exit 0**
  · `npm run build` built, "no test sign-in in dist", exit 0.
- `cd api && npx tsc --noEmit` exit 0 · `npm run strip-check` 75 files load ·
  `npm test` **39 files, 757 tests, exit 0**.
- Guards against the faults put back: POS-10 — hand-off, Terminal notice and
  "blocked again" each removed → 3 failed; POS-11 → failed ("expected 'slip
  opened' to be 'draft cleared'"); POS-12 → failed ("expected null to be
  'AC1'"). Each restored and green.
- `db/tests/run.sh`: not run — no database change.
- **Opened**, as the owner, API 8795 on `fidato_pos`, website 5178, the
  browser made to refuse new tabs where needed: Tables AC3 and AC4 (the
  notice; the second refusal's sentence; the button opened slip 4), the
  Terminal order 5 (notice under the header, no page scroll, no console
  error); two sends that replaced the page left no draft and no "not sent";
  AC5 → slip "KOT - 6 · Dine In · Table No: AC5"; the Menu at 375px (names
  171–178px, nothing past the row) and at a desk (one 44px line).

**Left open**
- **D17-21, this service's half** — still waits on banquet's front door. Built
  to the owner's answer when it is ready: an attached order settles "to the
  function" only. The banquet chat should hear the answer (its total rule is
  unchanged by it).
- Orders taken on Tables before the POS-12 fix keep no table name (the owner
  chose no back-fill).
- The Terminal sets no browser-tab title and its page reads "Fidato PMS" —
  the brief's P2, not touched today.

**Commits:** the commit that adds this entry.

---

## 2026-09-17 · The owner's D17-18, D17-19 and D17-20

**Asked for:** the owner's answers of 17 September
(`docs/briefs/decisions-2026-09-17.md`), the three that are the POS chat's —
*"Tables opens the kitchen slip on every send, like the Terminal"* (D17-18,
POS-5); *"on/off switches for add-ons on the Menu screen, like dishes have"*
(D17-19, POS-2); *"Tuesday, 25 August 2026" and the hotel's name with it, the
button included* (D17-20, POS-7). Then, once the banquet chat's front door is
ready, this service's half of D17-21.

**Shipped** — branch `pos/d17-slip-addons-dates`, copy `D:\fidato-pos`,
database `fidato_pos`. No migration, no server change.
- `flows/OrderPad.tsx` — a send the kitchen received opens its slip in a new
  tab, the Terminal's address and the Terminal's way. Nothing for a round on
  the bill alone or a round held on the device.
- `pages/Menu.tsx`, `data/till.ts` — each dish lists its add-ons under it, and
  each add-on has the dish's "Out of stock" control (one `OffControl` for
  both): 2/4/8/24 hours or Tomorrow, then "Off till … — put back". No "Why"
  (nowhere to keep one); a shared group names every dish it goes off on; the
  row wraps on a phone. `takeAddonOff` and `putAddonBack` give the two routes
  their first caller.
- `pages/DayEnd.tsx` — the heading line, the closed line, the toast and the
  button carry the day in words and the hotel's name, looked up by the page's
  own code (the code itself if no name is known). The button is two lines:
  "Close Tuesday, 25 August 2026" over "5 Elements Akkalkot".
- `ownerDecisions.test.tsx` — 9 tests; `readStates.test.tsx` — its day-end
  heading check now expects the hotel first.
- `DEFECTS.md` — POS-2, POS-5 and POS-7 fixed; POS-8 (mine, below), POS-9 and
  POS-10 new. `MODULE.md` — the add-on routes' caller, the docket's openers,
  the tests, the claim command, D17-21's state.

**Found**
- **POS-8, mine, before commit:** the add-on dialog's duration buttons called
  the posting prop directly, so the switch was sent and the dialog never
  closed. The tests passed — they checked only the request. The type check
  caught it; the test now waits for the dialog to close and the menu to reload,
  and fails with the fault put back.
- **On screen, before commit:** the new close button's label was 355px in a
  317px button and ran over both edges; now two lines. And a switched-off
  add-on's "Off till … — put back" squeezed the add-on's name to 0px on a
  phone; the row wraps now.
- **POS-9 (open):** on a phone every DISH row on the Menu screen shows no name
  (0px) and its last buttons sit 77px outside the card — as before today.
- **POS-10 (open):** a send slower than the browser's few seconds of allowed
  pop-ups opens no slip and says nothing — Tables and the Terminal alike.
- **For D17-21:** `app.banquet_event_total` (061) counts every settled order on
  a function whatever the payment method, so an attached order paid in cash at
  the till would be billed to the host too. How an attached order is paid is
  the owner's question, asked in chat.
- **A slip of mine, no harm:** reading a recorded API result I also started
  `npm test` in `api/` with a 5-second limit; the shell was cut off and the
  suite ran on in its own scratch database, which its harness drops on exit.

**Proved** — this copy, 17 September, after the last code edit
- `npx tsc -b --force`: exit 0 (the run before the POS-8 fix: exit 2, three
  errors in `Menu.tsx`).
- `npx vitest run src/modules/pos`: 29 passed, exit 0 (before the last two
  layout edits). Against the old code (the four source files stashed):
  `ownerDecisions.test.tsx` 8 failed — no slip opened, no add-on control, no
  hotel name — and the updated `readStates` check failed; the two "opens
  nothing" checks passed on both, as they must.
- `npx vitest run` (all): 27 files passed, 2 failed — `front-desk.test.tsx` and
  `stayViewStates.test.tsx`, each at ~8.5s while the API suite ran beside it.
  Those two and `nightAudit.test.tsx` (which failed the same way on the first
  run) rerun alone: 3 files, 15 tests, exit 0. **Second full run, final code:
  29 files, 278 tests passed, exit 0.**
- `cd api && npm test`: 39 files passed, exit 0.
- `npm run build`: built, "no test sign-in in dist (6 files checked)", exit 0.
- `db/tests/run.sh`: not run — nothing here touches the database.
- **Opened**, as the owner, API 8795 on `fidato_pos`, website 5178:
  Menu — Onions off for 2 hours (200; dialog closed; toast; "Off till 04:46 pm
  — put back"; `off_until` 16:46 in the database), the waiter's dish dialog on
  Tables showed Onions struck "off today", put back (200, "Onions is back on").
  Tables — AC1, Bhaaji Pau (Oil) with Curd, Send → the slip "KOT - 1", no
  price, order `20260825-1`. Close restaurant day — "5 Elements Akkalkot ·
  Fidato Restaurant · Tuesday, 25 August 2026", Finalize, the two-line button;
  no ISO date anywhere. Measured at a desk and at 375px: nothing over its
  edge, no sideways scroll. No console error after the mark.

**Left open**
- **D17-21, this service's half** — waits on banquet's front door
  (`getAttachableFunctions`, `whyNotAttachable`; being built on
  `banquet/diary-heading`, uncommitted when looked at) and on the owner's
  answer on how an attached order is paid.
- POS-9 and POS-10 — the owner decides; recommendations in `DEFECTS.md`.
- The toast on Tables still says "Kitchen docket 5." where the Terminal says
  "Order 5 is with the kitchen" — not part of D17-18, left as it was.
- For the master: root MEMORY lesson from POS-8 — *a test that checks only the
  request a screen sent passes while the screen never finishes the act.*
- The preview pane reads the master checkout's `launch.json`, so this copy's
  servers were run from a shell; `.claude/launch.json` here holds two local
  entries and is not committed.

**Commits:** the commit that adds this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the Point of sale menu entries and who works
  from each; `routes.tsx` — the nine screen addresses; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/pos/index.ts`, which mounts the till, the
  person side of the bridge and `/api/pos`.
- Step 4a (`23cd2e4`): `posBridge.ts` cut out of the shared `billing.ts` data
  file; the import report type left `till.ts` for the core
  (`src/data/repositories/importReport.ts`).
- Step 4 (`c2dd9d5`): moved in — pages Bill, DayEnd, Docket, Floor, Kitchen,
  Menu, Pos, Terminal, Till (from `src/pages/`); flows DishDialog,
  OrderHeaderPanel, OrderPad (from `src/components/flows/`);
  `components/PosGate.tsx` (from `src/components/app/`); `data/till.ts` and
  `data/posBridge.ts` (from `src/data/repositories/`); `lib/pricing.ts` (from
  `src/lib/`). The shared data index stopped re-exporting them.
- `3cd6f51`: `api/test/padTotal.test.ts` prices lines with
  `@/modules/pos/lib/pricing` directly — a server test must not load the
  restaurant's screens through its door.
- This brief: `MODULE.md` rewritten from the code — nine screens, 51
  endpoints, the tables and migrations, the owner's rules, open items; this
  file; `DEFECTS.md` indexing 42 root entries.

**Found** (while writing the brief; nothing numbered here)
- Nothing in the till sets `pos_orders.event_id`, so a bill cannot be charged
  to a banquet function — recorded as banquet `DEFECTS.md` BQ-1.
- Bill, Docket, Kitchen and Terminal set no browser-tab title; the two add-on
  on/off endpoints have no caller; `pages/Pos.tsx` draws two page headings
  (details in `MODULE.md`, Open items).

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored), so
  the session signs itself out — and the same 31 failed with the brief-only
  folders taken out. Every run also reports 2 unhandled rejections from
  `src/lib/outbox.ts` under jsdom, with or without these changes.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database. The move commits record their own
  gates in their messages (web types clean, 204 tests).

**Left open**
- The server code is still in `api/src/routes/till.ts` (3,555 lines) and
  `api/src/routes/pos.ts`; moving it into `api/src/modules/pos/` is step 5,
  in progress elsewhere. Splitting the till into parts is not done.
- Tests still live in `api/test/` and `src/App.test.tsx` (step 7);
  `db/tests/modules/pos.sql` does not exist yet.
- The root `CHANGELOG.md` and `HANDOVER.md` were not touched by this brief —
  the core owner's to update.

**Commits:** `e9dd6b1` · `23cd2e4` · `c2dd9d5` · `3cd6f51`, and the commit that
added this file.

---

## Before the move — entries in the root CHANGELOG.md

The restaurant's earlier work is recorded there. Read these entries in the
root file; the bodies are not copied here.

- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (review) · An audit, a security review, and an account takeover closed
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box
- 2026-09-08 (deploy) · Live, and four faults on the way there
- 2026-09-08 (night) · Course sequence and the pass by table — Stage C5
- 2026-09-08 (night) · Timing capture — Stage C3
- 2026-09-08 (late) · Preparation times — Stage C2
- 2026-09-08 (evening) · A room charge with the line down
- 2026-09-08 (later) · The order pad — Stage C4
- 2026-09-08 · Deploy to production, then Stage C

Before 8 September the root file has no entries: `git log`, `PROGRESS.md`
and `POS-PROGRESS.md` are the record.
