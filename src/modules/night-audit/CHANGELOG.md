# Night audit — changelog

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
- Step 3 (`e9dd6b1`): the menu entry in `nav.ts`, the screen address in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/night-audit/index.ts`, at first mounting
  `api/src/routes/nightAudit.ts`.
- Step 4a (`23cd2e4`): the night audit's calls were cut out of `billing.ts`
  into their own `nightAudit.ts`, in place.
- Step 4 (`66a685c`), moved into this folder:
  - page — `NightAudit.tsx` (from `src/pages/`)
  - data — `nightAudit.ts` (from `src/data/repositories/`)
- Step 5, the server (`489271d`): `nightAudit.ts` moved to
  `api/src/modules/night-audit/`, and the pre-flight checklist came out of
  the old `billing.ts` into `checklist.ts`; `nightAudit.test.ts` had moved to
  `api/test/modules/night-audit/` in `3424882`.
- This brief (`MODULE.md`), this log and `MEMORY.md`, written from the code
  at `c804aa2`.

**Found**
- Writing the brief: `GET /:code/night-audit/can-run` and
  `GET /:code/night-audit/runs` have no screen calling them (the API tests
  and `api/scripts/capture-demo.ts` do). The stale "THE NIGHT AUDIT DOES NOT
  RUN" header stayed behind in finance's `billing.ts` (finance's FIN-1).

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- The two endpoints with no screen.

**Commits:** `e9dd6b1`, `23cd2e4`, `66a685c`, `3424882`, `489271d`, and the
commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
