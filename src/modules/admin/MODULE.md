# Administration

Who works here and what they may do, which properties exist and how each is
set up to run, and the switches that turn parts of the system on or off.

**Folder name:** `admin` — the same word in all three places:

```
src/modules/admin/          the screens, their data calls, their tests
api/src/modules/admin/      the server's routes for this service
db/tests/modules/admin.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service in `HANDOVER.md` → "Folder claims"
(service, branch, date), read this file, then this folder's `DEFECTS.md` and
`CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`.

**This service holds the most dangerous code in the system** — the account
takeover of 9–15 September lived here (MEMORY 263). Read MEMORY 229, 230, 263,
264 and 271 before touching people or sign-in.

---

## What it is

The owner adds a property and its general manager. The GM adds the people
who work at their hotel, gives each a role and a password, sets the screen
each person starts on, and can take access away, switch somebody off or bring
them back. A group administrator sees every property and every person; a GM
sees their own hotel. The Settings screen shows how a property is set up,
including the GST it actually charges, and — for the owner and an
administrator only (D17-36) — the module switches: Point of sale, Banquet
hall, and "Reception can use the POS". The Audit log, Roles and permissions and Integrations are read
only. A developers' Console, in development builds only, can create
properties and people.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Properties | `/properties` | `pages/Properties.tsx` (`PropertiesPage`) | none |
| People | `/people` | `pages/People.tsx` | none |
| Administration → Users | `/admin/users` | `pages/Admin.tsx` (`UsersPage`) | none |
| Administration → Roles and permissions | `/admin/roles` | `pages/Admin.tsx` (`RolesPage`) | none |
| Administration → Integrations | `/admin/integrations` | `pages/Admin.tsx` (`IntegrationsPage`) | none |
| Administration → Audit log | `/admin/audit-log` | `pages/Admin.tsx` (`AuditLogPage`) | none |
| Administration → Settings | `/admin/settings` | `pages/Admin.tsx` (`SettingsPage`, with `GroupLogoCard` and `ModulesCard`) | none |
| Administration → Console | `/admin/console` | `pages/Console.tsx` | none — development builds only |
| — (not in the menu) one property | `/properties/:code` | `pages/Property.tsx` | reached from Properties |
| — (redirect) | `/admin/properties` → `/properties` | — | an old link, kept working |

- Properties and People sit in the menu's **Across properties** section;
  Administration in **System**.
- No working menu lists any of them. Owner, admin, GM, hotel manager, finance
  and read-only see what their grants allow: Properties needs `hotel`, People
  and Users `user`, Roles `role`, Integrations `integration`, Audit log
  `audit_log`, Settings `setting`. The Console is `devOnly` and shown only to a
  role that may *create* a hotel.
- **People works for the GM at their own hotel (D22-3, 22 September).**
  `GET /admin/staff` returns `rosterAt` (the hotels the signed-in person may
  roster at, with `app.grantable_roles` for each) and, per person, `mayEdit`,
  `maySwitch`, `maySetPassword` - the server's own answers. The screen offers
  only those buttons and pickers; a GM's "Add somebody" names the property and
  the role, and the role pickers never hold Owner or Admin for a GM (D22-2).
- **And for a hotel's Admin (D23-2, 23 September)** - somebody whose role AT a
  hotel is `admin`: the same as the GM there, plus Admin in the picker. Owner
  never. Migration 133 (`app.manages_hotel` counts `admin`; a closed day's
  record still needs owner or GM). They also open their own property's page,
  read-only, as the GM does (the owner, 24 September).
- **Nobody runs somebody above them (the owner, 24 September)** - nobody
  edits, removes, re-roles, switches off or resets the password of somebody
  whose role at that hotel they could not give: the GM leaves the hotel's
  Admin and Owner alone, a hotel's Admin its Owner (133's last section,
  ADM-7). People shows the × on a chip only for such a role (`mayTake`).
- The `/admin/*` routes are wrapped in `RequireAccess`; the Console's route
  does not exist at all in a production build (`IS_DEV`). `/properties/:code`
  answers a GM for their own hotel and 404 for anybody else's, because it
  carries the GSTIN (`routes.tsx`).
- Dialogs and panels in `flows/`: `StaffAdmin.tsx` (`NewPerson`, `People`,
  `NewProperty` — shared by Properties and the Console) and
  `CommissioningCard.tsx` (what a property still needs — shown on inventory's
  Room types page).

---

## Server endpoints — 22

The code is in `api/src/modules/admin/` (moved 15 September): `admin.ts`,
and the parts split out of three mixed files — `adminLists.ts` (from
directory.ts), `moduleSwitches.ts` (from property.ts) and `commissioning.ts`
(from inventorySetup.ts). The door `index.ts` mounts them.

From `admin.ts` (1,133 lines) — all 16, mounted at **`/api`** (creating a
property is not scoped to one):

```
POST   /api/admin/hotels                     create a property — needs the provisioning key
GET    /api/admin/hotels                     every property, closed ones included
GET    /api/admin/hotels/:code               one property, for whoever runs it
PATCH  /api/admin/hotels/:code               its name, address, phone, email, GSTIN…
PUT    /api/hotels/:code/fssai               its FSSAI licence number (A16): owner, admin, GM
POST   /api/admin/hotels/:code/:state        close or reopen
GET    /api/admin/staff
POST   /api/admin/staff                      add somebody — creates their sign-in account
PATCH  /api/admin/staff/:id                  name or phone
POST   /api/admin/staff/:id/password
POST   /api/admin/staff/:id/access           give a property and a role
DELETE /api/admin/staff/:id/access/:code
POST   /api/admin/staff/:id/deactivate
POST   /api/admin/staff/:id/reactivate
PUT    /api/admin/staff/:id/home-screen      the first screen, set by the GM
PUT    /api/me/preferences                   a person's own first screen, room grouping and
                                             Start here flag — called from the core
                                             (src/data/repositories/me.ts)
GET    /api/admin/overview                   the Console's figures
```

`adminLists.ts` (split out of directory.ts) — 3, at `/api/hotels`:

```
GET    /:code/staff        Users
GET    /:code/audit-log    Audit log — owner, admin, GM only; 403 otherwise (D17-15)
GET    /:code/settings     Settings  — owner, admin, GM (D17-36); 403 otherwise (D17-15)
```

**Who may read the audit log and Settings** is `grants.ts` (17 September,
API-2): a copy of the screen's rule, `canAccess(role, resource)` in
`src/lib/permissions.ts`, held to it by `api/test/modules/admin/grants.test.ts`.
A change to who may do what is made in `permissions.ts` by the master and
copied into `grants.ts` in the same commit, or that test fails.

`moduleSwitches.ts` (split out of property.ts) — 2, at `/api/hotels`:

```
GET    /:code/modules             read by Settings, the sidebar and Find a screen
POST   /:code/modules/:module     pos · banquet · reception_pos — owner or admin at this
                                  hotel, or a group admin; 403 otherwise (D17-36, ADM-5)
```

`commissioning.ts` (split out of inventorySetup.ts) — 1, at `/api/hotels`:

```
GET    /:code/commissioning       CommissioningCard
```

`groupLogo.ts` (27 September, D27-53) — 3, at `/api/hotels`. ONE logo for the
whole group (the hotel in the address is only where the person stands):

```
GET    /:code/group-logo          every active member of staff: { logo: { type, data } | null }
PUT    /:code/group-logo          { data: base64 } - the owner, an admin or the GM (roleGate,
                                  room setup; the owner, 27 Sep); a PNG or SVG by content,
                                  200 KB, no script-carrying SVG; refused before withSession
DELETE /:code/group-logo          the same three
```

The table is `group_logo` (its migration: "one logo for the whole group"),
one row, FORCE RLS, `app.sets_group_logo()` for writes, audited. It starts
EMPTY in every copy: the logo is uploaded, never put in a migration.

`PATCH /:code/front-desk` (the front desk's hours), which the plan gave to
this service, went to inventory in the server split, beside the Room types
page that holds its form — see inventory's brief.

Every endpoint above has a caller in the web app (checked 15 September).

---

## Data

```
data/admin.ts          375 lines. Roles and the permission matrix, read from
                       src/lib/permissions.ts (listRoles, listAssignableRoles,
                       getMatrix, getAdminSettings — three of those have no caller,
                       see Open items); and every write above: create a property or a
                       person, password, access, deactivate, reactivate, amend,
                       close/reopen, home screen; MIN_PASSWORD = 8.
data/adminLists.ts     212 lines. listStaff, roleDescription, listAuditLog,
                       listIntegrations — a fixed list written in the code, not read
                       from anywhere — and getSettings, which adds the invoice series
                       and the POS outlets over HTTP. Split out of the old directory.ts.
data/commissioning.ts  getCommissioning. Split out of the old roomSetup.ts.
data/taxInUse.ts       getTaxInUse — finance's GST rules over HTTP, for Settings and the
                       Properties cards (ADM-2, D17-37).
components/TaxInUse.tsx   TaxInUseRows and taxLine: the GST in use, one row per kind,
                       "-" where unset, "Could not load" on a failed read.
data/groupLogo.ts      getGroupLogo, setGroupLogo, removeGroupLogo, logoSrc and
                       useGroupLogo(hotelCode) - exported from index.ts for every
                       document: a data: URL for an <img src>, or null (print the
                       hotel's name). NEVER inline the logo as markup: an SVG can
                       carry a script; inside an <img> it runs none of it.
components/GroupLogoCard.tsx  Settings' Group logo card: the logo, Upload/Replace and
                       Remove for the owner, an admin and the GM.
moduleSwitchRoles.ts   MODULE_SWITCH_ROLES (owner, admin) — who sees the switches (D17-36);
                       the server's copy is in api/src/modules/admin/grants.ts.
flows/StaffAdmin.tsx   NewPerson, People, NewProperty.
flows/CommissioningCard.tsx   CommissioningCard (the door's export) and ReadyPill,
                       which nothing imports (checked 15 September).
```

---

## Database

```
hotels, staff, staff_hotels             002_tenancy.sql
  the placeholder administrator         008_seed.sql — REPLACE@fidato.in; inserted only where
                                        nobody else holds group access (ADM-3, MEMORY 271)
  room_type_templates; provision_property   009_provisioning.sql (templates lost their
                                        prices in 032_no_default_prices.sql)
  staff_hotels readable by the API      018_api_access.sql
  address, phone, email, GST on hotels  019_property_details.sql
  admin visibility of staff_hotels      020_deferred_fixes.sql
  the owner sees who works here         027_staff_visibility.sql
provisioning_keys                       029_provisioning_key.sql (app.require_provisioning_key)
  a group admin may write               030_admin_writes.sql (app.keep_one_admin,
                                        app.forbid_self_promotion)
  a clerk sees only their properties    031_property_visibility.sql
hotel_modules                           041_hotel_modules.sql — pos on unless switched off,
                                        banquet off until switched on
  the first real person                 051_bootstrap_admin.sql
  a property that never traded can go   066_delete_untraded_property.sql (app.delete_property)
  row-security helpers bypass RLS       068_rls_helpers_must_bypass.sql (MEMORY 148)
  one list of roles                     078_roles.sql (app.assignable_roles)
  a GM runs their own hotel             084_property_admin.sql (app.manages_hotel,
                                        app.grantable_roles, app.may_set_password,
                                        app.may_manage_person, app.require_hotel_admin)
  first screen, room grouping,          087_first_screen_and_reception_pos.sql
  reception_pos
  no claiming somebody's address        088_claiming_an_address.sql
                                        (app.require_claimable_address)
  Start here "Got it"                   089_start_here.sql
audit_log                               011_model_additions.sql; triggers from
                                        016_audit_coverage.sql and 076_approvals.sql —
                                        the Audit log screen does not read it; it reads
                                        the folio ledger
  who made a posting, recorded and      099_audit_log_names_the_person.sql —
  named                                 folio_postings.posted_by defaults to the signed-in
                                        person; app.posted_by_name(posting) (ADM-1)
  the GM runs their hotel's people,     127_the_gm_runs_their_people.sql (D22-2, D22-3):
  and makes no Admin                    app.grantable_roles without admin for a GM, the
                                        staff_hotels manager policies check the role,
                                        app.manages_person (edit), app.may_switch_person
                                        (switch off / on: every hotel theirs)
```

Isolation is checked as the application role in `db/tests/rls.sql`, never in
`suite.sql`, which runs as a superuser (MEMORY 47).

**A new migration takes the next number after cp6's highest and tells the
master**, who renumbers at merge if two lanes collide (`docs/briefs/README.md`).
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. This service's newest is 127 (22 September; numbered by the master's
word, so the master renumbers it at merge).

---

## Front door

`src/modules/admin/index.ts` exports `CommissioningCard`. Its one importer is
`src/modules/inventory/pages/RoomSetup.tsx`.

The server's door, `api/src/modules/admin/index.ts`, exports only `mounts`
(`["/api", admin]`), read by `api/src/server.ts`.

---

## Leans on

- **reports** — `getTodaySnapshot` and `getPeriodStatistics` through
  `@/modules/reports`, on one property's page.
- **finance** and **pos**, over HTTP, not by import: Settings reads
  `GET /:code/invoice-series` (finance's `invoices.ts`) and
  `GET /:code/pos/outlets` (the restaurant's bridge); Settings and every
  Properties card read `GET /:code/tax` (finance's `tax.ts`) for the GST in use.
  If any of them changes shape, those screens break. The five kind names in
  `components/TaxInUse.tsx` are a copy of `LABEL` in finance's `TaxRulesCard`.
- The core: `getModules` and `setModule` (`src/data/repositories/properties.ts`),
  the permission matrix (`src/lib/permissions.ts`), the session, and
  `api/src/identity.ts` (the sign-in accounts).

---

## Rules that bind it

- **The owner's instruction of 9 September** (quoted in
  `084_property_admin.sql`): the console can add a property and its GM; the GM
  gives access to his own staff, separately for each property. A GM may not
  roster at another hotel, appoint an owner, or reset a group
  administrator's password (MEMORY 230).
- **The first screen after sign-in** — Dashboard, Rooms or Calendar — is set
  by the GM per person, and the person can change their own (owner,
  14 September; `HANDOVER.md` § 4; 087).
- **The module switches belong to the owner and an administrator** — the
  owner's decision of 17 September (D17-36), which replaced "the GM's"
  (084; MEMORY 250). The GM opens Settings and does not see them; the server
  refuses anybody else (ADM-5). "Reception can use the POS" is on at 5
  Elements and off for a hotel added later (owner, 14 September; 087).
- **Tax on these screens is the tax actually charged** (D17-37): finance's
  rules, "-" where a kind has none. Never `hotels.cgst_rate`/`sgst_rate`.
- **Creating a property keeps the provisioning key** — without it the
  database refuses with a sentence (CHANGELOG 2026-09-08 "Three gates…";
  029; MEMORY 216). **The Console stays development-only** (PROGRESS "What the
  owner has decided").
- **Adding somebody makes them able to sign in** — the password is required
  (MEMORY 229), and nobody else's existing address may be claimed: 088 asks
  before Firebase is touched. A side effect that cannot be rolled back goes
  after every check (MEMORY 263). Nothing is emailed — a manager types the
  password and tells the person (PENDING § 6).
- **`api/.env` holds the Firebase Admin key** — never commit, print or echo it
  (`HANDOVER.md` § 5). Without `FIREBASE_SERVICE_ACCOUNT` a deployment refuses
  to add staff (PENDING § 6). A test run must never reach the live sign-in
  service — the API test wrapper blanks the key and `guards.test.ts` fails if
  it comes back (MEMORY 264).
- **Where migrations replay, a seeded row is switched off, never deleted.**
  If preflight says "no bootstrap accounts", People → "REPLACE — your name" →
  Deactivate (`HANDOVER.md` § 9; MEMORY 271).
- **One list of roles**: `app.assignable_roles()` (078) is the authority;
  `src/lib/permissions.ts` must equal it (`api/test/roles.test.ts`); the
  People picker derives from `ASSIGNABLE_ROLES` (MEMORY 184, 186). The stored
  value is an identifier; `ROLE_LABELS` are what people read.
- **A refusal is never a 200** (MEMORY 231), and a write that changed nothing
  never reports success (MEMORY 185).
- **Hiding a link is not access control.** `mayReach` returns true for a path
  the navigation does not know, so every `RequireAccess` path must be one it
  knows — `src/App.test.tsx` guards it (MEMORY 227; PENDING § 5).
- **Audit by capability, never by location** — adding people lives on
  `/people`, not under `/admin` (MEMORY 217).
- **A property that has traded is deactivated, never deleted**; one that never
  traded can be removed (066).
- **Every list draws four states**; **a new dialog declares its main action**
  (`HANDOVER.md` § 6, § 3.1).
- **Inside `withSession`, a refusal is a commit** (MEMORY 243); `admin.ts` has
  not been audited for it (PENDING § 2).

No Start here card and no glossary line names anything in this service. The
account menu's "Show Start here again" goes through `PUT /api/me/preferences`
in this service's server file.

---

## Open items

From `PENDING.md`, `PROGRESS.md` and `HANDOVER.md`, as of 15 September:

- **The placeholder administrator comes back on every deploy** once deleted.
  Asked, not answered: change `008_seed.sql` so a deploy never re-creates it
  where a group administrator exists (PENDING § 1a; MEMORY 271).
- **`demo@fidatohotels.com` holds the owner role at 5EL** with a shared
  password — the owner's decision of 15 September: leave it active while
  testing (PENDING § 1a). **Two stray accounts** on the live sign-in service,
  `owner@fidato.in` and `pune@fidato.in` — the owner's decision: leave them
  for now (PENDING § 1a).
- **The registered legal name and GSTIN for a bill, and bank details per
  hotel** — decided on 14 September (Fidato's name, chosen in settings; bank
  per hotel), not built; staff-first phase 3, ask first (`HANDOVER.md` § 3.5,
  § 4; PROGRESS "Still needing a person" 6, 7).
- **Whether the Console comes off its development-only gate**, and
  **per-hotel custom roles** (recommendation on file: no) — the owner's
  (PROGRESS "Still needing a person" 13, 14).
- **`mayReach` still fails open**; **no gate finds an API route with no
  caller** — how four admin endpoints sat unreachable (PENDING § 5; MEMORY 224).
- **`hotels.address_line` duplicates city and state** in the demo data —
  editable on Properties (PENDING § 6).
- **`listRoles`, `listAssignableRoles`, `getAdminSettings`** have no caller
  (PENDING § 4, KNOWN_UNREACHABLE).
- **"Which room was this stay in"** is written by hand in the Audit log's
  query (`directory.ts`) — one of seven copies (PENDING § 6).
- Found while writing this brief (15 September):
  - ~~ADM-1~~ — fixed 17 September: the Audit log records and names the person
    (`DEFECTS.md`).
  - ~~ADM-2~~ — fixed 17 September: Settings and every Properties card show
    the GST actually charged, and the GSTIN as stored (`DEFECTS.md`).
  - **Integrations is a fixed list in the code** (`listIntegrations`), with
    stage numbers and money figures typed into it. Nothing checks them against
    anything; worth the owner's look before a guest-facing demo.
  - `src/App.test.tsx` "the module switches" lists `pos` and `banquet` as the
    modules the API accepts; the API also accepts `reception_pos`. The test
    still checks every switch, so it holds; its list is stale.
  - The Console's heading says "Administration", its menu entry "Console"
    (development builds only).

---

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit     clean
          cd api && npm test             a scratch database, with the Firebase key blanked;
                                         never `npx vitest run` inside api/ (MEMORY 196, 221, 264)
          cd api && npm run strip-check  the server's loader can parse every file (MEMORY 209)
database  db/tests/run.sh                a scratch database, dropped after; runs rls.sql as pms_app
```

The guard this folder must respect: `src/test/boundaries.test.ts` — another
service reaches this one only through `index.ts`, and this one reaches others
only through theirs.

Where the checks are today: `api/test/adminWrites.test.ts`,
`propertyAdmin.test.ts`, `roles.test.ts`, `firstScreen.test.ts`, and blocks
in `guards.test.ts` ("the module gate", "the test suite and the live sign-in
service") — moving to `api/test/modules/admin/`. Web: `src/App.test.tsx`
("administration routes", "the admin console", "the module switches",
"every guarded route is one the navigation knows"). Database:
`db/tests/suite.sql` groups `access`, `firebase`, `seed hygiene`,
`provisioning`, `provisioning key`, `modules`, `property admin`,
`delete property`, `first screen`, `claim address`, `start here`, and
`db/tests/rls.sql` (frozen — new checks go in `db/tests/modules/admin.sql`,
which since 17 September holds "audit log names the person").
`api/test/modules/admin/grants.test.ts` (who may read the audit log and
Settings, every role) and `auditLog.test.ts` (the person recorded and named).

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
