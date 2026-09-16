# Changelog — the store

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

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
