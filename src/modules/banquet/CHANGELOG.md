# Changelog — banquet

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-12 · Halls and packages: every control disabled for those the server refuses (the owner's D27-307 (4))

**Asked for:** the master: Reception could press Add a hall, Edit and Add a
package, which the server refuses (HALLS, `room_config` edit); disable them
with the reason, as the package switch already was.

**Shipped:** `pages/BanquetSetup.tsx`: one `maySetUp` (was `maySwitch`,
`can(role, "edit", "room_config")`) disables Add a hall, each hall's Edit, Add
a package and the switches. The Halls card says "The owner, an administrator
or the GM adds and edits them."; the Packages line now ends "... adds and
switches them." MODULE.md says who.

**Proved:** `banquet.test.tsx` "shows reception the switches, Add a hall, Edit
and Add a package disabled, and who may" - failed on cp6's screen (Add a hall
enabled), passes on the fix; the same test as the GM finds all three enabled
and no sentence. Opened on a scratch copy of the demo with one hall and one
package: Reception, all four disabled with both sentences; the GM, all
enabled, no sentence.

**Left open:** nothing.

---

## 2026-10-12 · A package can be switched off, never changed (the owner's D27-305 (8))

**Asked for:** the master, 12 October: the A13 chapter helper's question
(LAPTOP-HANDOVER § 6, 8) answered - a package can be retired (an Off switch)
but not changed; past and existing functions keep it as sold.

**Shipped:** `PATCH /:code/banquet/packages/:id`, `{isActive}` and nothing
else (HALLS: owner, admin, GM); any other field, or none, is 409 "A package is
not changed once added. Switch it off, and add a new one for a new price or
menu." The catering route refuses a switched-off package for any function
("That package is switched off, so it is not offered for functions now.") and
an unknown one ("No such package here.", was Postgres's own words). Halls and
packages: an "Off" pill and a switch per package, disabled with "The owner, an
administrator or the GM switches them." for everyone else; the card says
"Never changed once added...". Add a course already offered only the packages
that are on. No migration: `is_active` is 061's.

**Proved (12 October, copy `.claude\worktrees\agent-ae37723ee392e7e37`):** API
`test/modules/banquet` 6 files, 42 of 42 (`banquet.test.ts` 15 of 15) - "a
package is retired, never changed" failed with cp6's server files (the PATCH
answered 404); `test/roleGate.test.ts` 79 of 79. Web
`src/modules/banquet` 19 of 19 - the two Halls and packages checks failed on
cp6's screen; the picker check passes on both (a guard, not a change). On the
demo (`fidato_d305`): as Reception the two switches are greyed with the
sentence; as the GM, Dinner buffet switched off showed "Off"; the Kulkarni
wedding reception kept "Dinner buffet, 120 plates · ₹900 each, ₹1,08,000";
its Add a course offered only "Off-menu" and "Veg thali · ₹450 a head".

**Left open:** the other setup buttons (Add a hall, Edit, Add a package) are
still pressable for reception and refused by the server - as before.

---

## 2026-10-03 · A function's bill offers the hotel's own payment methods (the owner's D27-259) - the cash lane's

**Shipped:** `FunctionBill.tsx` lists the hotel's ways of paying that are On (`payingWays`, migration 191) instead of the fixed five; the payment door takes only those.

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part D: a billed function keeps its hall (migration 156)

Branch `fix/leftovers-28sep` (cp6 7c52bb9, round D, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Found:** round E's "Bill the function" sets 'completed' any time after Confirm, and 060's guards held only 'confirmed', so a function billed ahead of its date freed its hall - a second function was confirmed into QA Hall over a billed one (BQ-12).
**Shipped:** migration 156 - `app.banquet_conflicts` and `be_no_double_booking` hold ('confirmed', 'completed'); "The hall is taken: …" with its capital (X-4). Re-runnable; the functions keep their signatures (MEMORY 317).
**Proved:** `bill.test.ts` "refuses to confirm another function over it" - 200 without 156 (the double booking), 409 with it; fidato_s30 migrated twice, exit 0 both times.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part C: reopen a billed function while no tax invoice stands (D27-150, D27-154)

**Asked for:** the owner's D27-154 (round E's question a). Branch `fix/leftovers-28sep` (cp6 6686af1, round A, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** `POST /banquet/events/:id/reopen` (FUNCTION_MONEY: owner, admin, GM). Refused before any write when the function is not billed, a tax invoice stands ("Tax invoice … stands on this bill. Only a credit note corrects it now."), no reason is given, or the bill was posted on a day the night audit closed. It reverses the hall and course lines through finance's `reverseFolioCharge`, the reason on each; advances, payments and restaurant orders stay; the function goes back to confirmed. `FunctionBill.tsx`: "Reopen the bill" for the same roles while no invoice stands, asking first with a required Why.
**Proved:** `bill.test.ts` "is refused while the tax invoice stands, and takes nothing off the bill" (failed without the route: 404); `roleGate.test.ts` pins the rule. On screen (QA test function, fidato_s30): billed at ₹25,000 + ₹4,500; Reopen disabled until a reason; reopened ("Bill reopened"), the ledger shows the hall line and its reversal "(why: Hall price agreed at 20,000, not 25,000)"; re-priced ₹20,000, billed, invoiced 5EL/2026-27/00001 (taxable ₹20,000); Reopen then gone, and the route refused it.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149): more guests than the hall holds, a plate count below one, Catering with nothing served (QA BQ-5)

**Asked for:** QA BQ-5. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** Register a function warns "More than this hall holds (n)" above the larger of its seated and standing figures (a warning, not a refusal); Add a course says "At least one plate." under Plates instead of a silent disabled Add; the function's money reads Catering "-" while nothing is served (was ₹0). Wording only, no test.
**Proved:** web banquet tests passed. On screen (QA Hall, seats 100 / 150): 500 guests warned; plates -10 said "At least one plate." with Add disabled; a new function showed Catering "-".
**Left open:** D27-150 (reopening a billed function) needs a reversal through finance's front door; asked the master, nothing built.

---

## 2026-09-28 · Fix round E: the function's bill, the banquet tax warning, Free prices, BQ-6, laundry and spa (QA 28 September)

**Asked for:** the master's round E (D27-116, D27-120, D27-124; the QA's
"Banquet, laundry and spa" table): reach and close a function's bill with the
smallest change, reusing finance; warn while the banquet tax is unset; a 0 only
when ticked Free; the other BLOCKS WORK and WRONG RESULT rows (laundry and spa).
Branch `fix/banquet-bill-28sep`, copy `.claude\worktrees\jovial-heisenberg-b447a6`,
database `fidato_s29`, API 8865, web 5265.

**Decided by the owner, 28 September** (asked here, each with a
recommendation; every recommendation taken; recorded D27-132 to D27-138):
Owner, Admin and GM take an advance, bill and settle, the Accountant also
issues the invoice; restaurant orders settled to a function reach its bill
like a room charge; SAC 996334 with food, 997212 for a hall alone (CA to
confirm, with whether one banquet rate covers both); a function with an
advance may be cancelled, a billed one may not; spa booked on a day of the
stay and charged once checked in, laundry from a checked-in guest; function
bills not on Folios; "Bill the function" any time after Confirm.

**Shipped** - DEFECTS BQ-9, BQ-10, BQ-11, BQ-6; laundry LAU-4; spa SPA-3.
Built on round A's per-bill door (cp6 8b171d5) and round D's
`api/src/validate.ts`. Outside banquet, with the master's yes: `pos/till.ts`
(a function's order onto its bill), `reports/figures.ts` (the day book counts
it once), `laundry`, `spa`, `api/src/roleGate.ts` (three write rules).

**Proved** - each new test seen to fail with the server files put back to
cp6's, and pass with them (numbers in the root CHANGELOG entry). On screen, as
the GM in the copy: the Free refusal, the telephone refusal, the tax warning,
advance, bill refused while the tax was unset, bill, settle, invoice, credit
note; laundry's stay list; the spa's refusal.

**Left open** - DEFECTS BQ-9: correcting a billed function's figures after a
credit note; refunding a cancelled function's advance; the invoice's
place-of-supply sentence (round A). Cosmetic rows BQ-4 to BQ-7 of the QA table
are not this round's.

---

## 2026-09-17 · The Diary's heading, restaurant food on a function's bill, and four more

**Asked for:** the owner's answers of 17 September
(`docs/briefs/decisions-2026-09-17.md`). D17-22: the Diary is headed "Diary"
(BQ-2). D17-21, banquet's half of BQ-1: a function's bill shows the restaurant
orders attached to it, and the front door exports the functions an order may
be attached to — the POS chat builds the till side after. And the three
questions from the brief read (BQ-3 to BQ-5), put to the owner with
recommendations. Branch `banquet/diary-heading`, copy `D:\fidato-banquet`,
database `fidato_banquet` (a copy of the development database).

**Decided by the owner, 17 September** (asked in this session, each with a
recommendation; every recommendation taken)
- Which functions the till may offer: **confirmed, bill open, running on the
  business date** (from its first day to its last).
- BQ-3: a failed read says so **the restaurant's way** (POS-4).
- BQ-4: the function's account is a **bill**.
- BQ-5: dates and times in **the shared formats**, 12-hour times included.
- BQ-7 (found today): **fix it now and keep the names**.
- BQ-6 (found today): **record it, fix later**.

**Shipped**
- BQ-2 — `pages/Banquet.tsx`: headed "Diary" in all three states (sets the tab).
- BQ-1, banquet's half:
  - `api/src/modules/banquet/attach.ts` — the one rule, in the property's time
    zone (a function ending at midnight has ended): `attachableFunctions` and
    `whyNotAttachable`, which says which part of the rule failed.
  - `GET /:code/banquet/attachable` — answers `{ enabled: false }` rather than
    refusing where banquet is off, because the till asks at every property.
  - The function route returns `restaurantOrders` (open and settled, not
    abandoned); `pages/BanquetEvent.tsx` lists them with outlet, table, time,
    status and amount, says an open one is not in the total until settled,
    and says plainly when there are none. The money line "From the till" is
    now "Restaurant orders", the list's own words.
  - Front doors: `getAttachableFunctions` and its types (website);
    `attachableFunctions` and `whyNotAttachable` (server).
- BQ-3 — the three reads throw; every screen tells refused (the server's
  sentence), unreachable (including a read React Query paused offline) and
  failed apart with Try again, and keeps what it had under "Not up to date"
  when a refresh fails. `components/ReadProblem.tsx`, a named copy of POS's.
- BQ-4 — "A bill is open for this function."
- BQ-5 — `format.ts` everywhere on the three screens; the API sends
  "Registered at" as a timestamp instead of a sentence.
- BQ-7 — no join to `staff`: names come from `app.colleague_name` (096) on the
  function, its courses and the diary.
- `MODULE.md` rewritten for all of the above; `DEFECTS.md` — BQ-2, 3, 4, 5, 7
  fixed, BQ-1 half done, BQ-6 open.

**Found**
- **BQ-3, BQ-4, BQ-5** — by reading on 16 September; described in `DEFECTS.md`.
- **BQ-7** — a function the owner registered opened as "No such function" for
  the GM; for a clerk, every function somebody else registered did. Measured:
  as the GM the readable `staff` rows were agra, desk and gm; as a clerk, their
  own. Root `MEMORY.md` 283's fault. Fixed.
- **BQ-6** — the reference maker has no lock and `lpad` cuts (`lpad('10000',
  4, '0')` is `1000`, measured). Root 280's fault. Open, by the owner's choice.
- **`db/migrate.sh --with-dev-identities` reports ✓ after an ERROR.** On a
  fresh database it printed `ERROR: dev-identities: expected 3 staff with dev
  uids, found 0` and then `✓ local sign-in accounts linked`, exit 0. And
  `api/scripts/load-demo.ts` fails on a fresh database (`Cannot read properties
  of undefined (reading 'id')` — it looks for `owner@fidato.in`, which 008 no
  longer seeds). Both are shared files: for the master, not fixed here. This
  copy's database was made from a dump of `fidato` instead.

**Proved** — run in `D:\fidato-banquet` on 17 September, on the tree committed
below
- `npx tsc -b --force`: exit 0. `cd api && npx tsc --noEmit`: exit 0.
  `npm run strip-check`: 76 files, exit 0.
- `cd api && npm test`: **764 passed, 41 files, exit 0.**
- `bash db/tests/run.sh`: **736 assertions, exit 0** — run before the BQ-7
  change, which touched no file under `db/`.
- `npx vitest run`: **278 passed, 2 failed, exit 1** —
  - `repositories.test.ts` Rule 2b, naming only `getAttachableFunctions`.
    Correct: nothing reaches it until the till imports it. Not worked around;
    the master's decision (`MODULE.md`, Requests).
  - `nightAudit.test.tsx` "sends the day it shows" — the master recorded it
    (HANDOVER, 17 September) as failing under load and passing alone. Here
    the full run was heavily loaded (collect 2,074 s); run alone straight
    after: 1 passed, exit 0. Not banquet's.
- `npm run build`: exit 0, "no test sign-in in dist (6 files checked)".
- Each new guard was seen to refuse:
  - `attach.test.ts` — the status filter removed (a cancelled function
    offered), the midnight rule removed (a function that ended at midnight
    offered the next day), abandoned orders let through: 3 failed, each with
    its own message. Restored and compared byte for byte.
  - `names.test.ts` — on the old route the GM and the clerk got 404 and the
    diary no name: 3 failed.
  - `banquet.test.tsx` — all 11 failed on the old pages, data and door, each
    on its own assertion; the heading test failed again with only the old
    heading put back.
- `npm run lane -- banquet`: all inside the lane, exit 0.
- **Not yet opened on screen.** The Browser pane starts servers only from the
  main folder's `.claude/launch.json`, which is the master's, and this copy's
  API has to run on its own port (8799) against `fidato_banquet`. The session
  moves into this copy for that check — the next step, before anybody relies
  on the screens.

**Left open**
- **The till's half of BQ-1** — the POS chat. Its claim says it is waiting on
  this front door.
- **Rule 2b** fails until then — the master decides how to carry it.
- **Request to the master:** one `ReadProblem` in the shared kit.
- **BQ-6**, by the owner's choice. Server-written sentences still print their
  own times (BQ-5, "Not covered").
- `db/tests/modules/banquet.sql` still does not exist: nothing here changed
  the database.

**Commits:** the commit that adds this entry, on `banquet/diary-heading`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — Diary and Halls and packages; `routes.tsx` —
  three screen addresses; `index.ts`; a first `MODULE.md`; and
  `api/src/modules/banquet/index.ts`, which mounts `banquet.ts`.
- Step 4 (`264e51b`): moved in — `data/banquet.ts` (from
  `src/data/repositories/`) and pages Banquet, BanquetEvent, BanquetSetup
  (from `src/pages/`). The shared data index stopped re-exporting them.
- This brief: `MODULE.md` rewritten from the code — three screens, 12
  endpoints, four tables, the owner's rules; this file; `DEFECTS.md` with two
  new entries and four root entries indexed.

**Found** (while writing the brief, by reading the code)
- BQ-1 · the till cannot charge a function: nothing sets `pos_orders.event_id`.
- BQ-2 · the Diary is headed "Banquet".

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
- BQ-1 and BQ-2 — the owner's calls (whether the till should charge a
  function; which word the Diary keeps).
- The server code is still in `api/src/routes/banquet.ts`; moving it into
  `api/src/modules/banquet/` is step 5, in progress elsewhere.
- `api/test/banquet.test.ts` has not moved (step 7);
  `db/tests/modules/banquet.sql` does not exist yet.

**Commits:** `e9dd6b1` · `264e51b`, and the commit that added this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 2) · One main action per screen
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 14, "Modules + banquet") are the record.
