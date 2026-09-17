# Changelog — the store

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-17 (phase 1A, merge 1) · Stock held per store, moves between stores, and the long dash gone

**Asked for:** the master, relaying the owner's third interview: merge cp6, read
`docs/briefs/decisions-2026-09-17.md`, build stock per place, clean the long
dash from this folder (D17-59, D17-60), then crockery (D17-69); migration 106;
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
- `db/migrations/106_stock_held_per_store.sql` — `location_id` on every
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
