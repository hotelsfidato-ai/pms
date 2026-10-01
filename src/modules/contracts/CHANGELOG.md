# Changelog — Contracts

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 30 September** (`MODULE.md`).

---

## 2026-09-30 · Contracts built: Add/Edit company, a contract per company and hotel, the booking priced by it (D27-178, D27-184)

Branch `contracts/rates-30sep` (from cp6 24d99f2), copy
`.claude\worktrees\laughing-jepsen-2b2ea7`, database `fidato_s41`, API 8891, web 5291.

**Asked for:** D27-178, build every service still Not built yet. The lane
planned first; the owner took all thirteen recommendations (D27-184, C-1 to
C-13; `MODULE.md`).

**Shipped:** migration 177: companies gain kind, state,
PIN and credit allowed, and their credit figures become not-set instead of 0;
`contracts` (one in force per company, hotel and date), `contract_rates`
(single and double), `reservations.contract_id`, `app.contract_in_force`,
`app.contract_price`. Seven routes in `api/src/modules/contracts`. The
Contracts page and a company's page; the Add/Edit company and Add/Edit
contract dialogs; `gstinProblem` (the check digit) in `api/src/validate.ts`.
Outside this folder, claimed for these lines only: reservations (`book.ts`
prices by the contract and stamps it and its commission; `BookingPage.tsx`
quotes through `/contract-price` and shows "Contract: <name>"), finance
(`postings.ts` refuses Bill to company without credit; `perBill.test.ts`'s
company allowed credit), guests (Add company on Companies and agents), and
the master's files it allowed (T-2): `server.ts`, `roleGate.ts` and its
test, `permissions.ts` (front_desk `company: create`), `navigation.test.ts`.

**Found:** CON-1 (an administrator could not change a company), CON-2 (a
credit limit nobody set read as 0), CON-3 (the booking sites are company
records; open with the owner).

**Proved:** `npx tsc -b --force` exit 0; `api` strip-check 165 files; web
tests contracts, contractPrice (fails on cp6's booking page), navigation,
boundaries, guests, reservations, lib: pass, except migrationNumbers on the
gap to 173, since renumbered 177. The API tests and the database test are
written and not yet run (the master's word).

**Left open:** the API and database runs; the screens in the browser pane
once `fidato_s41` is migrated; CON-3's answer.

**Commits:** 76c09aa, 5be91bf, 5f44249, ec8475a and the notes commit.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/contracts`, guarded), `pages/Contracts.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
