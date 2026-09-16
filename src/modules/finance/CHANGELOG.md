# Finance — changelog

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
  server, `api/src/modules/finance/index.ts`, at first mounting `folios.ts`,
  `billing.ts` and `invoices.ts` whole from `api/src/routes/`.
- Step 4a (`23cd2e4`): the mixed data files cut in place — `postings.ts`
  (folio reads, charges, settle) and `cashier.ts` (the drawer) out of
  `operations.ts`; `billing.ts` kept payments, billable and invoices; `tax.ts`
  out of `roomSetup.ts`; `folios.ts` gained the folio reads from `stays.ts`.
- Step 4 (`db4f061`), moved into this folder:
  - pages — `Billing.tsx`, `Cashiering.tsx`, `Folios.tsx`, `Invoice.tsx`,
    `Invoices.tsx` (from `src/pages/`)
  - flows — `CreditNoteFlow.tsx`, `FolioPanel.tsx`, `TaxRulesCard.tsx`
    (from `src/components/flows/`)
  - data — `billing.ts`, `cashier.ts`, `folios.ts`, `postings.ts`, `tax.ts`
    (from `src/data/repositories/`)
  - the door gained what front desk and inventory use; front desk's move
    (`880a5b6`) repointed this folder's imports to front desk's door.
- Step 5, the server: `folios.ts` moved to `api/src/modules/finance/`
  (`3424882`); `postings.ts` and `cashier.ts` cut out of `operations.ts`
  (`b772047`); `billing.ts` kept receipts and billable folios when the old
  file split four ways (`489271d`); `invoices.ts` moved and gave Form C to
  guests (`1dcf9b7`); `tax.ts` cut out of `inventorySetup.ts` (`3ca215d`).
  `api/test/invoices.test.ts` moved to `api/test/modules/finance/`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- FIN-1 (this folder's `DEFECTS.md`): the header of
  `api/src/modules/finance/billing.ts` still says no invoice number is issued
  and the night audit does not run. A comment, not a screen; not fixed.
- Noticed, not investigated: `getFolioBalance` answers `0` for a stay with
  no folio (`data/postings.ts`).

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's `front-desk.test.tsx`, 2 in
  reports'); with `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of
  204 (the 4 left in `src/App.test.tsx`, not investigated). This change is
  Markdown only.

**Left open**
- FIN-1, and the zero balance above.

**Commits:** `e9dd6b1`, `23cd2e4`, `db4f061`, `3424882`, `b772047`,
`489271d`, `1dcf9b7`, `3ca215d`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
