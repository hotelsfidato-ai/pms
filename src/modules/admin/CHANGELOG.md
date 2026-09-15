# Changelog — administration

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
- Step 3 (`e9dd6b1`): `nav.ts` — Properties, People and the Administration
  group; `routes.tsx`; `index.ts`; a first `MODULE.md`; and
  `api/src/modules/admin/index.ts`, which mounts `admin.ts` at `/api`.
- Step 4a (`23cd2e4`): the mixed data files cut by service, in place —
  `adminLists.ts` out of `directory.ts`, `commissioning.ts` out of
  `roomSetup.ts`; `admin.ts` gave its rate setup to inventory and a person's
  own preferences to the core (`me.ts`).
- Step 4b (`8a1e9a4`): `Properties.tsx` cut out of `Directory.tsx`.
- Step 4 (`17453d3`): moved in — `data/` admin, adminLists, commissioning
  (from `src/data/repositories/`); flows CommissioningCard and StaffAdmin
  (from `src/components/flows/`); pages Admin and Console (from
  `src/pages/admin/`), People, Properties and Property (from `src/pages/`).
  The door gained `CommissioningCard` for inventory's Room types.
- `7553031`: a person's own preferences take their types from the core; the
  door stopped exporting them.
- This brief: `MODULE.md` rewritten from the code — nine screens and a
  redirect, 23 endpoints, the tables and migrations, the owner's decisions;
  this file; `MEMORY.md` with two new entries and thirty root entries indexed.

**Found** (while writing the brief, by reading the code)
- ADM-1 · the Audit log names "admin" as the person behind every entry.
- ADM-2 · Settings and Properties show the flat CGST/SGST that 067 replaced;
  Settings calls every GSTIN a demo.
- Not numbered: Integrations is a fixed list with typed figures; a stale
  module list in `src/App.test.tsx`; `ReadyPill` has no importer (details in
  `MODULE.md`, Open items).

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
- ADM-1 and ADM-2 — not fixed.
- The server code is still in `api/src/routes/admin.ts` and parts of
  `directory.ts`, `property.ts` and `inventorySetup.ts`; moving it is step 5,
  in progress elsewhere. `property.ts`'s module routes are mounted by the core
  until then.
- The admin tests have not moved (step 7); `db/tests/modules/admin.sql` does
  not exist yet.

**Commits:** `e9dd6b1` · `23cd2e4` · `8a1e9a4` · `17453d3` · `7553031`, and the
commit that added this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (review) · An audit, a security review, and an account takeover closed
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box
- 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 17, "Commissioning a real property") are the record.
