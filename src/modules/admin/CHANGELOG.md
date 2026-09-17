# Changelog — administration

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-17 · The audit log names the person, and the server refuses what the screen refuses

**Asked for:** the owner's answers of 17 September (`docs/briefs/decisions-2026-09-17.md`),
handed over by the master — **D17-14** (ADM-1): the audit log records and shows
the real person, not "admin"; **D17-15** (API-2): `GET /:code/audit-log` and
`GET /:code/settings` refuse every role without the grant, exactly like the
screens, tested for every role.

**Shipped** — branch `admin/audit-log-who`
- `db/migrations/099_audit_log_names_the_person.sql` — `folio_postings.posted_by`
  defaults to the signed-in person, so the four statements that never set it
  (finance's charge, reversal and payment; front desk's walk-in room charge)
  now record who, with no change to either service's files; and
  `app.posted_by_name(posting)`, the name of whoever made a posting at a
  property the caller is at — including somebody whose access has since been
  removed.
- `api/src/modules/admin/grants.ts` — who may read the audit log (owner, admin,
  GM) and Settings (owner, admin): the screen's `canAccess` rule, copied.
- `api/src/modules/admin/adminLists.ts` — both routes ask first and answer 403
  with a sentence naming who may; the audit log returns the person's name or
  null instead of the word "admin".
- `src/modules/admin/data/adminLists.ts`, `pages/Admin.tsx` — `actor` may be
  null; the By column prints a dash, and the note under the table says what a
  dash means.
- Tests: `db/tests/modules/admin.sql` (new, 12 assertions),
  `api/test/modules/admin/grants.test.ts` (35), `auditLog.test.ts` (8).
- `DEFECTS.md` (ADM-1 and API-2 moved to Fixed), `MODULE.md`.

**Found**
- **ADM-1 was two defects, not one.** The route typed "admin", and behind it
  148 of 176 postings in the development database recorded nobody — every one
  made at the desk. Fixing the screen alone would have shown a dash on nearly
  everything reception does.
- **The GM cannot open Settings, and never could.** The matrix gives `setting`
  to the owner and an administrator only; the screen refuses the GM. The
  server now agrees. `MODULE.md` says "the module switches belong to the GM",
  and those switches are ON the Settings screen — so a GM has no screen to
  flip them from today. Not changed: that is the owner's call.
- **The server needs 099 before it serves the audit log.** Opened against a
  database migrated before 099 was written, `GET /audit-log` answered 500
  ("function app.posted_by_name(bigint) does not exist"). Not a code fault —
  `deploy/launch.sh` migrates before it restarts the API — but the API and
  099 must go out together, never the code alone.
- **ADM-4** · the night-audit checklist and a notification link to
  `/h/<code>/admin/audit-log`, which lands on the Dashboard. Not this service's
  files; recorded in `DEFECTS.md` and passed to the master.
- **Mine, caught before they cost anything:** I first gave my API port 8795,
  which the finance chat's copy already uses — found reading the other copies'
  launch configs before starting anything. And a command meant to rerun two
  failed test files built the file list from the wrong log, came back empty,
  and `npx vitest run` with no files ran the whole suite; stopped and rerun
  with the files named. The lesson for everyone: **an empty file list is not
  "no tests" to vitest, it is all of them.**

**Proved** — run in `D:\fidato-admin` on 17 September, judged by exit code
- `bash db/tests/run.sh` — 748 assertions, exit 0 (12 new: "audit log names
  the person").
- `bash db/tests/rerun.sh` — all 99 migrations re-runnable, exit 0.
- `cd api && npm test` — 799 tests in 41 files, exit 0, 99 migrations applied.
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0 ·
  `npm run strip-check` exit 0 (76 files).
- `npm run build` — exit 0, "no test sign-in in dist".
- `npx vitest run` (web, 269 tests) — **did not finish green on this machine**:
  three runs under heavy load from other chats (44 node processes; one run took
  964 s against 170 s) each ended exit 1 on a TIMEOUT in a different file —
  night audit's `nightAudit.test.tsx`, then front desk's `front-desk.test.tsx`
  and `stayViewStates.test.tsx`. Each passed run alone: 1 test exit 0; 14 tests
  exit 0. No failure was an assertion, and none is in a file this branch
  touches. The master's merge run is the one to trust.
- **Guards seen to fail**, then restored byte for byte: without the column
  default, 4 database assertions; with the name function narrowed to people
  still rostered, exactly "a person whose access was removed is still named";
  with the audit-log role check removed, 11 API tests (all 10 roles without
  the grant, and a GM elsewhere who is reception here); with the hotel manager
  added to Settings, 2; with `actor: "admin"` put back, 6.
- **Opened the screens** (API on `fidato_admin` at 8796, web at 5181):
  - As reception, a charge and its reversal through finance's own routes
    (unchanged) recorded Test Reception — checked in the table.
  - `/admin/audit-log` as the owner and, after a full reload, as the GM:
    178 rows, By = Test Reception 2 · Group Owner 18 · POS test outlet 10 ·
    a dash 148; no row says "admin"; the note under the table explains the
    dash. The GM reads the owner's name.
  - `/admin/settings` as the GM and `/admin/audit-log` as reception: "This page
    is not part of your role". Over HTTP the same people get 403 with the
    sentence naming who may; the owner gets 200.
  - Browser console: no errors.

**Left open**
- ADM-2 (the old tax on Settings and Properties), ADM-3 (the master's) — not
  touched.
- Rows written before 099 keep no person: the ledger is append-only and who
  made them was never recorded. They print a dash.
- Migration number **099** taken — **the night-audit chat's claim names 099
  too**; the master renumbers one at merge. Nothing here refers to it by number
  except its file name.
- **The GM and the module switches** — the owner's call whether a GM should
  reach Settings (or the switches should move); nothing changed here.
- **ADM-4** — the broken audit-log links, for night audit and the core.

**Commits:** the one commit on `admin/audit-log-who` that adds this entry.

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
  this file; `DEFECTS.md` with two new entries and thirty root entries indexed.

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
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
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
