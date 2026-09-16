# Reservations — changelog

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
  server, `api/src/modules/reservations/index.ts`, at first mounting
  `api/src/routes/groups.ts`.
- Step 4a (`23cd2e4`): the groups reads came out of `stays.ts` into
  `groups.ts`, in place.
- Step 4 (`51a48c9`), moved into this folder:
  - pages — `GroupPanel.tsx`, `Groups.tsx`, `NewBooking.tsx`,
    `Reservations.tsx` (from `src/pages/`)
  - flow — `GroupRoomsPanel.tsx` (from `src/components/flows/`)
  - data — `groups.ts` (from `src/data/repositories/`)
  - the door gained what front desk uses.
- Step 5, the server (`3424882`): `groups.ts` moved to
  `api/src/modules/reservations/`, and `reservationInserts.test.ts` to
  `api/test/modules/reservations/`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- RES-1 (this folder's `DEFECTS.md`): `POST /:code/bookings` writes the guest,
  and for several rooms the group, before four of its refusals — defect
  243's shape in the booking door. Read in the code while writing the
  brief; not reproduced, not fixed.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- RES-1.
- The groups list, `GET /:code/groups`, stayed in front desk's `stays.ts`
  through the split; whether it should move here is not settled.

**Commits:** `e9dd6b1`, `23cd2e4`, `51a48c9`, `3424882`, and the commit that
adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
