# Changelog — reports

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
- Step 3 (`e9dd6b1`): `nav.ts` — the Dashboard and twelve report entries,
  ten of them search-only; `routes.tsx`; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/reports/index.ts`, which mounts
  `statistics.ts`, `reports.ts` and `manager.ts`.
- Step 4 (`295c176`): moved in — `components/ReportShell.tsx` (from
  `src/components/reports/`); `data/` managerReport, reportData, statistics
  (from `src/data/repositories/`); pages Compliance, Index, Ledgers,
  ManagerReport, Statistics (from `src/pages/reports/`) and Dashboard (from
  `src/pages/`). The door gained `getCityLedger` for finance's Billing and the
  statistics reads for admin's property page.
- `e754c49`: the data files take the business date from the core.
- This brief: `MODULE.md` rewritten from the code — thirteen screens, 13
  endpoints, what it reads, the rules; this file; `DEFECTS.md` with three new
  entries and eleven root entries indexed.

**Found** (while writing the brief, by reading the code)
- REP-1 · Monthly occupancy and Monthly statistics always show August 2026;
  Yearly statistics always 2026.
- REP-2 · the year to date always starts on 1 April 2026.
- REP-3 · All reports is headed "Reports".

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
- REP-1, REP-2, REP-3 — not fixed.
- The server code is still in `api/src/routes/reports.ts`, `statistics.ts`
  and `manager.ts`; moving it is step 5, in progress elsewhere.
- `api/test/reports.test.ts` and the report tests in `src/App.test.tsx` have
  not moved (step 7).
- Staff-first phase 2 (reports in the owner's layout) — ask first
  (`HANDOVER.md` § 3.4).

**Commits:** `e9dd6b1` · `295c176` · `e754c49`, and the commit that added
this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 10, "Group dashboard and reports") are the record.
