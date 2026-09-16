# Housekeeping — changelog

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
  server, `api/src/modules/housekeeping/index.ts`, at first mounting
  `api/src/routes/housekeeping.ts`.
- Step 4a (`23cd2e4`): the board, whose rooms are whose, and work orders
  were cut out of `operations.ts` into their own `housekeeping.ts`, in place.
- Step 4 (`b06ce9e`), moved into this folder:
  - pages — `Housekeeping.tsx`, `WorkOrders.tsx` (from `src/pages/`)
  - flow — `OutOfOrderFlow.tsx` (from `src/components/flows/`)
  - data — `housekeeping.ts` (from `src/data/repositories/`)
- Step 5, the server (`3ca215d`): `housekeeping.ts` moved to
  `api/src/modules/housekeeping/`, and room status and blocks were cut out
  of the core's `property.ts` into `roomStatus.ts`.
- `11d77a3`: the board catches a device with no offline store instead of
  leaving an uncaught error (root MEMORY 274).
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- Nothing new. Noted in the brief: room status and blocks are still called
  from the core's `src/data/repositories/rooms.ts`, while their endpoints
  now live here.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- Defect 218, the board's missing refresh — deferred by the owner.

**Commits:** `e9dd6b1`, `23cd2e4`, `b06ce9e`, `3ca215d`, `11d77a3`, and the
commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
