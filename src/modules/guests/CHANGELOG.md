# Guests and companies — changelog

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
  server, `api/src/modules/guests/index.ts`, at first mounting
  `directory.ts` and `bookingSources.ts` whole from `api/src/routes/`.
- Step 4a (`23cd2e4`): Form C's calls were cut out of `billing.ts` into
  `formC.ts`, and the staff, audit log and settings lists out of
  `directory.ts`, in place.
- Step 4b (`8a1e9a4`): `src/pages/Directory.tsx` held six screens for four
  services; Guests and Companies and agents became `src/pages/Guests.tsx`,
  cut section by section.
- Step 4 (`610bee7`), moved into this folder:
  - pages — `BookingSources.tsx`, `FormC.tsx`, `Guests.tsx` (from `src/pages/`)
  - data — `bookingSources.ts`, `directory.ts`, `formC.ts` (from
    `src/data/repositories/`)
  - the door gained what reservations, front desk and the channel manager use.
- Step 5, the server: `directory.ts` (the guests part) and `bookingSources.ts`
  moved to `api/src/modules/guests/`, and `bookingSources.test.ts` to
  `api/test/modules/guests/` (`3ca215d`); Form C came out of `invoices.ts`
  into `formC.ts` (`1dcf9b7`).
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- GUE-1 (this folder's `DEFECTS.md`): the `/companies` screen, "Companies and
  agents" in the menu, is headed — and tabbed — "Booking sources". Seen in
  the code while writing the brief; not yet on screen; not fixed.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- GUE-1.
- Form C's server tests are still in finance's
  `api/test/modules/finance/invoices.test.ts`.

**Commits:** `e9dd6b1`, `23cd2e4`, `8a1e9a4`, `610bee7`, `3ca215d`,
`1dcf9b7`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
