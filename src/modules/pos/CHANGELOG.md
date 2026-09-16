# Changelog — the restaurant (POS)

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

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
