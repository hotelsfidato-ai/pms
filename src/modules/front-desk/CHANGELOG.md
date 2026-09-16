# Front desk — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/front-desk/index.ts`, at first mounting
  `stays.ts`, `operations.ts` and `stayExtras.ts` whole from
  `api/src/routes/`.
- Step 4a (`23cd2e4`): the mixed data files cut in place — `operations.ts`
  kept check-in and check-out, walk-ins, room moves and void, and handed
  finance's charges and cash drawer and housekeeping's board to files of
  their own; `stays.ts` handed its folio reads to finance's `folios.ts` and
  its groups to reservations' `groups.ts`.
- Step 4 (`880a5b6`), moved into this folder:
  - pages — `Arrivals.tsx`, `InHouse.tsx`, `StayView.tsx`, `WalkIns.tsx`
    (from `src/pages/`)
  - thirteen flows — `AmendStayFlow`, `AssignRoomFlow`, `CheckInFlow`,
    `ExchangeRoomFlow`, `HouseFloor`, `InclusionsFlow`, `LateCheckOutFlow`,
    `MoveRoomFlow`, `StayActions`, `StayDrawer`, `StayMarks`, `VoidFlow`,
    `WalkInFlow` (from `src/components/flows/`)
  - `components/StayTable.tsx` (from `src/components/lists/`)
  - data — `operations.ts`, `stayExtras.ts`, `stays.ts`, `stayview.ts` and
    `stayview.test.ts` (from `src/data/repositories/`)
  - the door gained what finance, reservations and reports use.
- Step 5, the server: `stays.ts` and `stayExtras.ts` moved to
  `api/src/modules/front-desk/` (`3424882`); `operations.ts` moved and
  handed its money half to finance's `postings.ts` and `cashier.ts`
  (`b772047`).
- Step 7 (`f02c781`): the tape chart's tests moved out of `src/App.test.tsx`
  into `front-desk.test.tsx` in this folder.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- The move had silently narrowed a guard: rule 2b of `repositories.test.ts`
  (no exported data function without a caller) read only
  `src/data/repositories`; it was widened to every data folder and to door
  imports (the `880a5b6` commit; root MEMORY 272 — a project-wide lesson,
  kept in the root file).
- Writing the brief: `flows/WalkInFlow.tsx:27` holds `const USER = "front
  desk"`, a third copy that MEMORY 256 and `HANDOVER.md` § 6 do not name.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in this folder's `front-desk.test.tsx`, 2 in
  reports'); with `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of
  204 (the 4 left in `src/App.test.tsx`, not investigated). This change is
  Markdown only.

**Left open**
- Where `GET /:code/groups` belongs: the split left it in this service's
  `stays.ts` (see `MODULE.md`).
- The `WalkInFlow.tsx` literal above.

**Commits:** `e9dd6b1`, `23cd2e4`, `880a5b6`, `3424882`, `b772047`,
`f02c781`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
