# Changelog — administration

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-24 · Nobody switches their own access off (D24-19), and ADM-8

**Asked for:** the master, through the front desk follow-ups session
(branch `front-desk/follow-ups-24sep`): D24-19, a GM or a hotel's Admin may
not switch their own access off on People - refused on the server before any
write, with words that say who can, the control hidden on one's own row; and
H, a refused removal that said "They did not have access to that property".

**Shipped** - `api/src/modules/admin/admin.ts`: the access delete refuses
your own and says so, then refuses a role you cannot give in those words,
above the delete; `GET /admin/staff` says `maySwitch` false on your own row.
`pages/People.tsx`: no ✕ on your own chips. Details and proof: ADM-8.

**Left open** - changing your own role is still allowed (ADM-8, Left).

---

## 2026-09-24 · A hotel's Admin runs its people; nobody runs somebody above them; adding somebody new works; ADM-3; SPA-2; PUR-1; working menus (D23-2, D22-9, D22-11, D22-19, D22-22)

**Asked for:** the master, 24 September: finish three helper branches stopped
on 23 September mid-task (`admin/hotel-admin-menus`, `marketing/mkt1-d22-17`,
`stores/issue-outlet-rooms-persist`), on `admin/finish-24sep`.

**The owner's answers, 24 September (asked in this chat):** adding somebody
new is fixed now (ADM-6); Purchasing goes in housekeeping's menu; laundry's
working-menu entry is Dockets only; a hotel's Admin also opens their own
property's page, read-only, as the GM does; **nobody edits, removes,
re-roles, switches off or resets the password of somebody whose role at that
hotel they could not give.**

**Shipped**
- **D23-2** - migration **133** (the helper's 131; cp6's front-desk merge took 130-132 while this ran):
  `app.manages_hotel` counts `admin` at the hotel, so a hotel's Admin adds,
  rosters, edits, switches off and resets passwords for that hotel's people
  as a GM does, and `app.grantable_roles` gives them Admin there (Owner
  never). A closed day's record still needs owner or GM (100's trigger names
  them itself). People's "may not add" sentence names the Admin.
- **Nobody runs somebody above them** (the owner, 24 September) - the same
  migration: `may_manage_person`, `manages_person`, `may_switch_person` and
  the `staff_hotels` update and delete policies ask "a role I could give
  there" (`role = any (app.grantable_roles(hotel))`) instead of "a hotel I
  run". The GM leaves the hotel's Admin and Owner alone - until now a GM
  could reset an Admin's password and sign in as one (ADM-7); a hotel's
  Admin leaves its Owner alone. People offers the × on a chip only for a role
  the viewer could give (`mayTake`).
- **ADM-6** - `POST /admin/staff` no longer writes the person with one
  `insert … on conflict do update … returning`, which asks staff's READ
  policies about a row a GM cannot read yet. Somebody already here is
  updated; anybody else is inserted with an id made in the route.
- **ADM-3** - `008_seed.sql` inserts `REPLACE@fidato.in` only where nobody
  else holds group access. Kept as an edit to 008 on purpose: every deploy
  replays 001 onwards, so a later migration cannot stop 008 inserting the row
  earlier in the same replay - it could only switch it off again afterwards.
- **SPA-2** - `spa` off the accountant and the viewer; the diary's menu entry
  reads the matrix again.
- **PUR-1 / D22-11** - housekeeping `purchasing: view, create`, and
  Purchasing in housekeeping's menu (the owner, 24 September).
- **D22-19 / D22-22** - Rooms in housekeeping's menu, the Store in the
  kitchen manager's, laundry's Dockets in reception's and housekeeping's (the
  GM and hotel manager see the Laundry section already). Housekeeping still
  lands on Housekeeping and the kitchen manager on Kitchen (`WORKING_HOME`).
- Also on this branch, not this service's: D22-23 (`src/App.tsx`, the
  master's file - the Rooms board kept for an offline reload), MKT-1 and
  D22-17 (marketing), D22-20 (stores), the default-policy fix (inventory).
  Each is in its own service's log.

**Found**
- **ADM-7** (fixed here) - above.
- The helper's ADM-6 was right: the add path had never run past Firebase in
  any suite. `api/test/modules/admin/addPerson.test.ts` stands in for the
  account and runs the route to the rows.

**Proved** (this copy, database `fidato_s3`, API 8815, web 5215)
- `api/test/modules/admin/addPerson.test.ts` - 3 tests; with the old route,
  all 3 fail on "new row violates row-level security policy for table staff".
- `db/tests/modules/admin.sql` - "hotel admin" 12, "above them" 11,
  "placeholder" 1. With 133's last section taken out and cp6's 008 put back:
  7 failed ("1 removed", "1 placeholder rows after a replay").
- `admin.test.tsx` "takes nobody off the hotel whose role there the GM could
  not give" - fails with the old `runs(code)`.
- A second `db/migrate.sh` over the loaded demo database: 0 placeholder rows.
- Screens: `.local/screenshots/2026-09-24-admin/` 01-06 (menus by role), 12
  (Purchasing as housekeeping), 13 (Rooms as housekeeping), 14 (People as a
  hotel's Admin: the GM's card has every action), 15 (People as the GM: the
  Admin's card has none, and no × on "5EL · Admin").

**Left open**
- On People a GM or a hotel's Admin can still switch THEMSELVES off (as the GM
  could before). Not asked.

## 2026-09-22 · The role list after PMS-2, and People for the GM (D22-2, D22-3, D22-30 to D22-36)

**Asked for:** the owner's answers of 22 September
(`docs/briefs/decisions-2026-09-22.md`), handed over by the master as one
helper task on branch `admin/roles-d22`.

**Shipped**
- **The matrix** (`api/src/permissions.ts`, which the website re-exports):
  the GM creates and edits room setup (D22-30); an administrator and the GM
  edit commission (D22-30); `approve` on an invoice - the credit note - is the
  owner's, an administrator's, the GM's and the accountant's (D22-33); a new
  resource `menu` (the restaurant's menu) held by the owner, admin, GM and
  kitchen manager, viewed by the hotel manager, reception and a viewer - never
  the revenue manager (D22-35).
- **The server's gate** (`api/src/roleGate.ts`): the by-name GM and admin
  exceptions for room setup and commission are gone; the credit note asks
  `invoice approve`; the menu asks `menu edit`; the unused `staff` rule kind is
  gone. GST stays owner, admin, GM and accountant (D22-32, confirmed); the
  night audit stays as it is (D22-36, pinned by a test).
- **Repairs** (housekeeping's files, D22-34): `REPAIR_UPDATERS` - owner, admin,
  GM, hotel manager, Inventory Manager, housekeeping - asked by PATCH
  work-orders and by POST for any repair that names no equipment. The list
  says `mayUpdate`; Work orders offers Start and Close only then, and says who
  may otherwise.
- **Credit note button** (finance's `CreditNoteFlow.tsx`): disabled, with who
  may, for anybody without `invoice approve`.
- **Menu entry** (pos's `nav.ts`): the `menu` grant, so the revenue manager's
  menu no longer lists it.
- **People for the GM** (D22-3): migration 127 adds `app.manages_person`
  (edit) and `app.may_switch_person` (switch off and on - only somebody who
  works at no hotel the GM does not run). `PATCH /admin/staff/:id`,
  `reactivate` and `deactivate` ask them instead of "group administrator
  only". `GET /admin/staff` returns `rosterAt` and three flags per person;
  People offers only what the server will take, and a GM's Add somebody names
  their property and the role.
- **No Admin from a GM** (D22-2): `app.grantable_roles` drops `admin` for a
  GM (a hotel-level owner keeps it); the manager policies on `staff_hotels`
  refuse a role outside that list; both routes that grant a role answer
  "Only the owner or an administrator can make somebody an Admin."

**Found:** the accountant holds the GST write on the server but has no way to
the GST card (it sits on Room types, a `room_config` screen). A hotel-level
`admin` role cannot manage staff at all (`app.manages_hotel` is owner and gm
only). Both are questions for the owner, in the master's report.

**Left open:** see the report - the accountant's way to the GST card; whether
a hotel-level Admin should manage staff; whether a repair to the lobby counts
as "a room repair".

---

## 2026-09-17 (evening) · The tax actually charged, and the GM's Settings without the switches

**Asked for:** the owner's second interview of 17 September, handed over by
the master — **D17-37** (ADM-2): Settings and the Properties cards show the
tax actually used, "-" where nothing is set; and the screen half of
**D17-36**: the GM may open Settings, with the module switches hidden from
the GM (the master changes the grant). `docs/NEXT-BUILD-PLAN.md` step 1.

**Asked the owner first, and answered the same evening** — all three as
recommended:
1. The switch **route** let the GM in and kept the administrator out, the
   reverse of D17-36. *Screen and server* — both, in admin's files.
2. The Settings route's server copy of the role list must move with the
   master's grant. *I add the GM on this branch*; the master merges the
   grant first.
3. The owner's own Properties cards showed no tax. *Both cards* show it.

**Shipped** — branch `admin/audit-log-who`
- `data/taxInUse.ts`, `components/TaxInUse.tsx` — the GST a property charges,
  read from finance's `GET /:code/tax` and worded once: one row per kind,
  "5% up to ₹7,500 · 18% above ₹7,500", "5%", or "-"; "Could not load" on a
  failed read, never "-".
- `pages/Admin.tsx` (Settings) — the GST rows in "Tax and billing"; the
  switches only for `MODULE_SWITCH_ROLES`; the "editable at Stage 8" pill gone.
- `pages/Properties.tsx` — both cards draw the same rows; "CGST 2.5% + SGST
  2.5%" is gone.
- `moduleSwitchRoles.ts` — owner and admin, for the screen.
- `api/src/modules/admin/grants.ts` — the GM joins the Settings read list;
  `MODULE_SWITCH_ROLES` and `maySwitchModules` for the switch route.
- `api/src/modules/admin/moduleSwitches.ts` — asks `maySwitchModules` instead
  of `app.manages_hotel`, before the write; the unused cgst/sgst copy dropped.
- `api/src/modules/admin/adminLists.ts` — Settings sends no CGST/SGST, says
  where the tax goes (`taxInUse`) and where it is set, and prints the GSTIN as
  stored or "-".
- Tests: `src/modules/admin/admin.test.tsx` (new, 11),
  `api/test/modules/admin/moduleSwitches.test.ts` (new, 17),
  `settings.test.ts` (new, 7); `api/test/firstScreen.test.ts` — "the GM can
  flip it" is now "the GM cannot flip it".
- `DEFECTS.md` (ADM-2 fixed, ADM-5 found and fixed), `MODULE.md`.

**Found**
- **ADM-5** — the switch route's rule was the decision's two roles the wrong
  way round (`app.manages_hotel`: group admin, or owner/GM at the hotel).
- **The till still tells reception "The general manager can turn it on in the
  property's settings"** (`api/src/modules/pos/till.ts:93`). After D17-36 the
  GM cannot. POS's file — for the master.
- `tax: { cgst, sgst }` in the core `GET /api/hotels/:code` now has no reader.
  The core's — for the master.
- **Mine, found by opening the card:** every test passed while a 355px
  Properties card cut the rooms line to "5% up to ₹7,500 · 18% abo…" — the
  card's `Line` truncates. Tax lines now wrap, and break only between rates;
  `admin.test.tsx` checks both, and failed both card tests with the old line
  put back.
- **Mine, and serious — MEMORY 277 again, into the master's database.** I
  started the web suite in the background as `cd /d/fidato-admin && npx
  vitest run` in the same message as a type check that ran `cd api`. The
  shell's working directory moved under it: the run's header read
  `RUN v2.1.9 D:/fidato-admin/api`, so it was the API suite without its
  scratch-database harness. The app side used this copy's `api/.env`
  (`fidato_admin`, no Firebase key — nothing reached the live sign-in
  service), but the tests' superuser fixtures default to `fidato`, **the
  master's development database**. Six files ran for about 30 seconds
  (18:42:38–18:43:07) before I saw POS test names in a "web" run and stopped
  it. Measured read-only afterwards, from `audit_log` and every table's
  `created_at`: every updated row in `fidato` — 90 reservations, 3 rooms, a
  room type, a guest, a menu item — is back exactly as it was (first `before`
  = last `after`); the rows the tests inserted and deleted are gone. **Left
  behind:** an active add-on group "VARTEST Other" with an add-on "Pickle"
  ₹10 at 5EL (`till.test.ts`), and 18 inactive fixture staff (`eqr-*`,
  `hkr-*`) with no access. Not removed: that database is the master's. Rerun
  as `npx --prefix /d/fidato-admin vitest run --root D:/fidato-admin`, header
  checked before the result was read. **The rule: a command that depends on
  its directory takes the directory as an argument, never from the shell —
  and never beside another command that runs `cd`. Read a test run's `RUN`
  line before its results.**

**Proved** — run in `D:\fidato-admin` on 17 September, judged by exit code
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0 ·
  `npm run strip-check` exit 0 (80 files) · `npm run build` exit 0, "no test
  sign-in in dist".
- `cd api && npm test` — 897 tests in 49 files: **895 passed, 2 failed —
  exactly the two that wait on the master's grant** ("'setting': exactly the
  roles the matrix lets open the screen", "'gm' reading 'setting'"), exit 1.
  With the grant applied temporarily (`gm: setting: READ`, then removed —
  `permissions.ts` is byte-identical to cp6): the admin and first-screen
  files, 112 tests in 7 files, exit 0.
- `npx vitest run src/modules/admin/admin.test.tsx` — 11 passed, exit 0; no
  React warnings in the run.
- `npx --prefix /d/fidato-admin vitest run --root D:/fidato-admin` — header
  `RUN v2.1.9 D:/fidato-admin`; 338 tests in 36 files, exit 0.
- Not run: `db/tests/run.sh` and `rerun.sh` — no migration and no database
  file on this branch since the last entry.
- **Guards seen to fail**, then restored byte for byte: switches shown to
  every role (the GM test); "0%" for an unset kind (4 web tests); dashes on a
  failed read (its test); the card line truncating (2); the GM added to the
  server's switch list (the list test and the GM's case); the "demo" GSTIN
  suffix put back (2 API tests).
- **Opened the screens** (API 8796 on `fidato_admin`, migrated to cp6; web
  5181; the master's grant applied temporarily so the GM's page is the merged
  one):
  - Over HTTP: owner and GM read Settings — GSTIN as stored, the tax marker,
    no CGST; reception 403 with the sentence. The GM and reception flipping
    Banquet hall: 403, "Switching a module on or off is for the owner or an
    administrator", the switch unmoved.
  - `/admin/settings` as the owner: Modules with 3 switches; Tax and billing
    reads GST on rooms "5% up to ₹7,500 · 18% above ₹7,500", restaurant "5%",
    bar, banquet and everything else "-", then "Financial year starts 1 April";
    nothing says CGST, SGST, Stage 8 or demo.
  - The same page as the GM, after a full reload: no Modules card, 0 switches,
    the same GST rows.
  - `/properties` as the GM (the ordinary card) and as the owner (the owner's
    card): the five GST rows, nothing cut once fixed.
  - `/admin/settings` as reception: "This page is not part of your role".
  - Console: one "403 (Forbidden)" — the Properties page asks the owner-only
    property list for every role and shows the ordinary cards on a refusal,
    by design; not from this change. The request had left the pane's buffer,
    so which call it was is inferred from the code, not seen.

**Left open**
- **Merge order:** the master's grant (`gm: setting: READ` in
  `src/lib/permissions.ts`) first, then this branch. On this branch alone
  `api/test/modules/admin/grants.test.ts` fails exactly 2 tests — the Settings
  list and the GM's Settings read — by design.
- ADM-3 (the master's), ADM-4 (night audit's and the core's) — unchanged.
- The long dash still stands elsewhere on these screens ("—" on the owner's
  card, the audit log's By column): step 2, the master's dash pass.

**Commits:** the commit on `admin/audit-log-who` that adds this entry.

---

## 2026-09-17 · The audit log names the person, and the server refuses what the screen refuses

**Asked for:** the owner's answers of 17 September (`docs/briefs/decisions-2026-09-17.md`),
handed over by the master — **D17-14** (ADM-1): the audit log records and shows
the real person, not "admin"; **D17-15** (API-2): `GET /:code/audit-log` and
`GET /:code/settings` refuse every role without the grant, exactly like the
screens, tested for every role.

**Shipped** — branch `admin/audit-log-who`
- `db/migrations/101_audit_log_names_the_person.sql` — `folio_postings.posted_by`
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
- **The server needs 101 before it serves the audit log.** Opened against a
  database migrated before 101 was written, `GET /audit-log` answered 500
  ("function app.posted_by_name(bigint) does not exist"). Not a code fault —
  `deploy/launch.sh` migrates before it restarts the API — but the API and
  101 must go out together, never the code alone.
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
- Rows written before 101 keep no person: the ledger is append-only and who
  made them was never recorded. They print a dash.
- Migration written as 099, **renumbered 101 by the master at merge** (POS and night audit took 099 and 100) — **the night-audit chat's claim named 099
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
