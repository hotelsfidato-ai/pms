# Changelog — banquet

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
- Step 3 (`e9dd6b1`): `nav.ts` — Diary and Halls and packages; `routes.tsx` —
  three screen addresses; `index.ts`; a first `MODULE.md`; and
  `api/src/modules/banquet/index.ts`, which mounts `banquet.ts`.
- Step 4 (`264e51b`): moved in — `data/banquet.ts` (from
  `src/data/repositories/`) and pages Banquet, BanquetEvent, BanquetSetup
  (from `src/pages/`). The shared data index stopped re-exporting them.
- This brief: `MODULE.md` rewritten from the code — three screens, 12
  endpoints, four tables, the owner's rules; this file; `MEMORY.md` with two
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
- Every line under "Before the move" below, and in `MEMORY.md`, was matched
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
