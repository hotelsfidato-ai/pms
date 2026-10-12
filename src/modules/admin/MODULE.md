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
sees their own hotel. **Settings** (D27-213, D27-214, 30 September; D27-220,
1 October) is the ONE place for how a property is set up, in five tabs, and
shows ONLY what somebody can change: it mounts the cards that exist (the
profile, the hotel's logo and photos, FSSAI, the group's name, logo and office details,
the GST rules, bank details, the front desk's hours, house policies, the
switches) and links the few screens where a tab's subject is set; what the
property still needs is a checklist above the tabs, drawn only while something
is missing. For the owner and an administrator only (D17-36) — the module
switches: Point of sale, Banquet
hall, and "Reception can use the POS"; and, on a card of their own, New
booking's four fold-open sections (Company, GST, Extras, Notes; D27-163,
migration 159: on until turned off, and nothing is refused when one is off). The Audit log, Roles and permissions and Integrations are read
only. A developers' Console, in development builds only, can create
properties and people.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Properties | `/properties` | `pages/Properties.tsx` (`PropertiesPage`) | none |
| People | `/people` | `pages/People.tsx` | none |
| Settings console | `/settings/<group>/<slug>`, its own space (D27-249) | `pages/Settings.tsx` opens the page registered at the address (`src/components/app/settingsConsole.ts`); phase 1's stand-ins are `console.settings.ts` + `pages/ConsolePages.tsx` (resource `setting`: owner, Admin, GM; then each page's own rule) | none: reached by the top bar's space switcher |
| — (Find a screen) Users | `/admin/users` | `pages/Admin.tsx` (`UsersPage`) | none |
| — (Find a screen, and Settings › People) Roles and permissions | `/admin/roles` | `pages/Admin.tsx` (`RolesPage`) | none |
| — (Find a screen) Integrations | `/admin/integrations` | `pages/Admin.tsx` (`IntegrationsPage`) | none |
| — (Find a screen, and Settings › People) Audit log | `/admin/audit-log` | `pages/Admin.tsx` (`AuditLogPage`) | none |
| — (Find a screen, and Settings › People) Activity | `/admin/activity` | `pages/Activity.tsx`: every change `audit_log` holds (D27-243 5.1); "Across the group" for the owner and an Admin (D27-245 Q-A); a guest's details read "changed", masked on the server | none |
| — (Find a screen, and Settings › People) Sign-ins | `/admin/sign-ins` | `pages/SignIns.tsx`: a person's sign-ins, 90 days, time and device (5.4); owner and Admin only (Q-B) | none |
| — (redirects) | `/settings`, a bare group and every old tab (`/settings/:tab`, `/h/:code/settings/:tab`, the five of 1 October and the eight of 30 September) → its console page (`MOVED` in `pages/Settings.tsx`); `/admin/settings` → `/settings`; `/admin/configuration` → `/settings/rates/taxes` | — | old links, kept working |
| — (Find a screen) Console | `/admin/console` | `pages/Console.tsx` | none — development builds only |
| System health | `/admin/system-health` | `pages/SystemHealth.tsx` | none — the owner and an administrator (`role`) |
| — (not in the menu) one property | `/properties/:code` | `pages/Property.tsx` | reached from Properties |
| — (redirect) | `/admin/properties` → `/properties` | — | an old link, kept working |

- Properties and People sit in the menu's **Across properties** section;
  System health in **System**; Settings is a space of its own (the top bar's
  switcher, D27-249). "Administration" and its children
  left the sidebar on 30 September (D27-214): `listed: false`, so Find a
  screen still reaches them (Roles and the Audit log also from Settings › People).
- **The Settings console** (D27-249, D27-256): a navy menu of nine groups (Property, Rooms, Rates and tax, Money, Lists, Front desk, Messages, People and security, Modules and connections) and "Back to front office"; a group is drawn only when it holds something for the person. Phase 1 re-homed the five tabs unchanged (`console.settings.ts`): Property › Profile (the profile, FSSAI, and the commissioning checklist while something is missing), Logo and photos, Policies, Group; Rates and tax › Taxes; Money › Bank details; Front desk › Times and rules (the front desk card and rules); People and security › Signing in; Modules and connections › Modules (owner and Admin). The screens the tabs linked are links (↗) under the menu's own names. A phase takes a stand-in over by registering the same group and slug in its own `*.settings.ts`.

  Not drawn, because nobody can change them: the code, currency, time zone
  (Properties, every address and invoice number; currency and time zone are
  kept and used by the server), the financial year (every invoice number on
  Finance › Invoices), the GST repeated (the GST card; every Properties card),
  check-in and check-out as fixed rows (the front desk card), sellable rooms,
  room types and rate plans (Room types, Rates). The department setups are in
  their own sections of the menu. A link row is drawn only if
  `flatNavigationFor` holds its address for this person (role and modules),
  and takes the menu's own name and glyph; People and Connections, links only,
  are not shown to somebody who can open none. To add a screen to a tab, add
  its address and one line to `LINKS` in `pages/Settings.tsx`.
- **Settings' look** (the fidato-design skill): cards 12px apart, stacked full
  width (no pair of cards whose heights differ); a card's heading is
  `SettingHeader` (the title, one line, anything longer behind the (i));
  values are `SettingValues` of `SettingRow` (a 12px label over a 14px
  value, four across where the card is 512px wide, two below, `wide` for a
  long value); link rows at least 56px with the menu's glyph in a 28px chip.
  All three are in `pages/Admin.tsx`.
- **The hotel's name is a group administrator's** (D27-214, D27-308 (3)): the
  profile's Edit locks Name for anybody but a group administrator ("A group
  administrator changes the name."), and the server refuses a changed name
  from them. Everything else is the hotel's owner's, GM's and
  Admin's (`app.manages_hotel`), audited by `hotels_audit`.
- **Properties' cards (D27-308):** the group administrator's card counts
  "All rooms" (every active room, `GET /admin/hotels`); everybody else's
  counts "Rooms sellable today" (`app.sellable_rooms`, `GET /api/hotels/:code`).
  "Calendar" and "Open the Calendar" open `/h/:code/calendar`. Somebody who is
  owner, GM or Admin AT a property (`app.manages_hotel`'s roles, read from
  the session's scope) gets "Open" to its page on the ordinary card too.
- **One property's page (D27-308):** its figures ask the reports door with
  no date, so the server answers on that property's own business date and
  month, not the selected one's; average rate and RevPAR are a dash when
  nothing is sold. Add somebody here starts on Reception; its password and
  the password window use People's `PasswordBox` (hidden, with Show).
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
  `CommissioningCard.tsx` (what a property still needs — above Settings'
  tabs since 1 October, only what is missing; the Getting started tab on 30
  September; on inventory's Room types before). A row whose `to` starts
  "/settings" opens that tab; the rest open the hotel's own screen.
  On a phone (under 640px, read with `matchMedia`) each row is one line,
  a button with `aria-expanded`; a tap shows the reason, which links to the
  fix (D27-223). Wider screens show the reasons, the row a link, as before.
- **Test hotels (the owner's D27-296, 10 October; the screens' half).** A
  test hotel is the hotel GET /api/hotels gives a `testOf` (its real hotel's
  code); `src/lib/testHotel.ts` reads it, the shell draws the stripe
  (`src/components/app/TestHotel.tsx`). Here: **Properties** puts a real
  hotel's test hotel on that hotel's card, never a card of its own, and only
  for a group administrator (`components/TestHotelControls.tsx`): "Make a
  test hotel" with its one sentence, then its name with TEST, Open (switches
  to it and opens its Rooms), Reset (typed RESET) and Re-copy setup (typed
  RE-COPY), each saying what is deleted and what stays and, after, the
  server's figures ("Removed N records"); a refusal is the server's
  sentence. The calls are `makeTestHotel`, `resetTestHotel`,
  `recopyTestHotel` (`data/admin.ts`, `POST /api/admin/hotels/:code/test-hotel
  | test-reset | test-recopy`). **People**: Add somebody has a Test switch
  for a group administrator (on: only test hotels, "Works only in the test
  hotel, never the real one"; off: only real hotels, as before); Give a
  property lists test hotels with TEST for a group administrator, and only
  test hotels to somebody who works only in them; a person's test-hotel
  place carries TEST. Anybody else is never offered a test hotel. Tests:
  `testHotels.test.tsx`.

---

## Server endpoints — 39

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
PATCH  /api/admin/hotels/:code               its address, phone, email, GSTIN…: a group admin, or the
                                             owner, GM or Admin AT that hotel; the name a group admin only.
                                             And the profile (D27-214): addressLine2, pin, pan, website,
                                             reservationsPhone, propertyType, starRating, latitude,
                                             longitude - each refused in a sentence; sent blank a field
                                             is CLEARED, not sent it is left alone (the seven older
                                             fields keep what they had when sent blank)
PUT    /api/hotels/:code/fssai               its FSSAI licence number (A16): owner, admin, GM
POST   /api/admin/hotels/:code/:state        close or reopen
GET    /api/admin/staff
POST   /api/admin/staff                      add somebody — creates their sign-in account
PATCH  /api/admin/staff/:id                  name or phone
POST   /api/admin/staff/:id/password     10 characters for a group admin or anybody holding owner,
                                             admin or gm; 8 otherwise (D27-243 5.3); records whether it was long
GET    /api/admin/staff/:id/sign-ins     time and device, 90 days (5.4): app.sign_ins_of decides who
GET    /api/me/password                  the signed-in person's own: is a longer password due (D27-245)
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
GET    /:code/activity     activity.ts: every change, paged (scope, who, kind, from, to); scope=group
                           for owner and admin only (D27-243 5.1, D27-245)
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

`setup.ts` (13 October, the owner's D27-311) — 2, at `/api/hotels`. **Set up
this hotel**: 18 steps in the owner's order (`STEP_IDS`; the types `StepId`,
`SetupStep`, `Setup`, `SetupChoice` and `STEP_TITLES` are exported from this
file and from the door):

```
GET    /:code/setup               { steps: [{ id, state: done|todo|later|remind, automatic,
                                    detail, remindOn, by, at }], ready } - the hotel's owner,
                                  GM or Admin, or a group administrator (`setting` view in the
                                  gate; app.manages_hotel here); 403 for anybody else there
PUT    /:code/setup/:step         { choice: completed|later|remind|clear, remindOn? } -> { ok }
                                  the same people (room setup edit in the gate); refused:
                                  an unknown step 404, go-live 409, "completed" on an
                                  automatic step 409, remind without a real day 400, a day
                                  before the hotel's today 400
```

DONE IS DERIVED, never stored: profile, taxes, room types, rooms, prices,
cancellation and people ask `commissioningChecks` (commissioning.ts - asked,
not copied); payments asks for the bank details and a way of paying switched
on. Those are `automatic` (a hand Completed is refused). The rest are by hand,
but tick themselves where the rows show it: charges (an extra charge, a
discount, a commission or an early/late fee), messages (a daily report email
on with an address), branding (the hotel's own logo, a photo and a highlight),
connections (SU, the CRS or rivals' prices). Front desk, booking sources,
modules, policies and lists only by hand (their rows start filled in, or are
the group's). Go-live: done when 1-5 are; never stored. "done" wins over a
stored later/remind. The bell asks `setupReminders` (routes/notifications.ts):
a "remind" step whose day (the hotel's own date) has come and is not done -
"Setup: <title>", linking `/h/<code>/setup?step=<id>`, for owner, Admin, GM.

`groupSettings.ts` (27 September, D27-53 and D27-65) — 4, at `/api/hotels`.
ONE setting for the whole group (the hotel in the address is only where the
person stands): the group's name, printed "by <name>" under the property's
name on every bill, and its logo:

```
GET    /:code/group               every active member of staff:
                                  { name | null, logo: { type, data } | null,
                                    hotelLogo: { type, data } | null } - hotelLogo is
                                  the OWN logo of the hotel in the address (D27-214)
PUT    /:code/group/name          { name } - blank clears, 80 characters at most
PUT    /:code/group/logo          { data: base64 } - a PNG or SVG by content, 200 KB,
                                  no script-carrying SVG; refused before withSession
DELETE /:code/group/logo          the logo only; the name stays
PUT    /:code/group/office        the group's office details for the voucher's footer (D27-215):
                                  address, phone, email, website, GSTIN, Instagram; sent blank
                                  clears; the owner, an administrator or the GM
PUT    /:code/logo                THIS hotel's own logo (D27-214, table hotel_logos):
DELETE /:code/logo                the same picture rules; the owner, an administrator
                                  or the GM at that hotel (roleGate HOTEL_LOGO, and
                                  app.manages_hotel in the table's policy)
```

The property's profile (phase 2 of the settings plan; D27-249, D27-257; `property.ts`, 194):

```
GET    /:code/property-profile    { registrations, texts, childFreeAge, childMaxAge, map }
PUT    /:code/registrations       { registrations: [{ label, number }] } at most 4
PUT    /:code/texts/:kind         { body } plain, 2000; blank removes. Kinds: about,
                                  attractions, directions, activities, landmarks,
                                  parking, family, reservation_terms
PUT    /:code/child-ages          { free, max } words only - no price reads them
GET    /:code/amenities           ONE group list + this hotel's on + used + mayKeep
PUT    /:code/amenities/:id       { on } this hotel's switch (the logo's three)
POST   /:code/amenities           { name } the owner or an Admin (app.keeps_amenities)
PATCH  /:code/amenities/:id       { name?, isActive? } the same
PUT    /:code/amenities/order     { ids } the same
DELETE /:code/amenities/:id       the same; refused while a hotel has it on
```

The console pages (`property.settings.ts`): property/photos, /highlights,
/amenities, /policies (`pages/property/`); Profile joins when phase 1 exports
today's profile card, with `RegistrationsCard` (4 numbers + Open on map) under
it. Phase 3 points room_type_amenities at `amenities`.

The hotel's photos (D27-243, D27-244; `gallery.ts`, table `hotel_photos`, 186):

```
GET    /:code/gallery             { photos: [{ id, caption, width, height }], most: 20 }
                                  in order; everybody who works there
GET    /:code/gallery/:id         { type: "image/jpeg", data } - Settings draws it
POST   /:code/gallery             { data: base64, caption? } - a JPEG by its bytes,
                                  1600 px and 600 KB at most, Exif taken out,
                                  20 a hotel; the owner, an administrator or the GM
                                  at that hotel (roleGate HOTEL_GALLERY)
PATCH  /:code/gallery/:id         { caption } - 120 characters, blank is none
PUT    /:code/gallery/order       { ids } - each of the hotel's photos once
DELETE /:code/gallery/:id
```

The page shrinks a photo before it is sent (online-checkin's `shrinkPhoto`);
the server reads the file's segments and does not decode pixels, so no image
library is needed (D27-244). Kept in Postgres so the nightly dump carries
them. The guest's page shows them behind the code (online-checkin's
`GallerySection`, `api/src/routes/guestGallery.ts`). The reset keeps them.

**Which logo a document prints** is decided in ONE place, `useGroupSettings`
(`data/groupSettings.ts`): the hotel's own where it has one, the group's where
it has not. Every `DocMasthead` takes its logo from that hook, so a new
document gets the rule by using it. Two documents do NOT go through it:
- **the voucher PDF** - sent with nobody signed in, its logo is read inside
  `app.guest_voucher`. Migration 168 (section 5) re-creates that function with
  the one expression changed: the hotel's own PNG, else the group's PNG. The
  PDF draws PNG only, so a hotel whose own logo is an SVG prints the group's
  on its voucher; the logo card says so.
  `api/test/modules/guest-messaging/viewVoucher.test.ts` holds the rule and
  that nothing else in the function moved from 158;
- **the guest's page** (`/g/:token`) - it shows no logo at all; left out of
  this job by the master (30 September), the owner to say whether it should.

Every write: the owner, an admin or the GM (roleGate, room setup; the owner,
27 Sep). The table is `group_settings` (its migration: "the group's name and
logo"), one row, FORCE RLS, `app.sets_group_settings()` for writes, audited.
It starts EMPTY in every copy: the name is typed and the logo uploaded, never
put in a migration.

`bankDetails.ts` (1 October, D27-215) — 3, at `/api/hotels`. A hotel's bank
details, printed on its booking voucher when set:

```
GET    /:code/bank-details        whoever manages that hotel (app.manages_hotel); anybody
                                  else 403 - reception has no use for an account number
PUT    /:code/bank-details        account name, number (9-18 digits), bank, branch, IFSC,
                                  UPI ID - each refused in a sentence; roleGate BANK_DETAILS
DELETE /:code/bank-details        the same people
```

Table `hotel_bank_details` (169): FORCE RLS on app.manages_hotel for reads and
writes, audited by app.write_audit. That audit row is what the group owner's
bell reads (D27-216): `api/src/routes/notifications.ts` (the core's) tells a
group administrator, for EVERY hotel whichever is open, "<hotel>: bank details
set / changed / removed", by whom - never the account - for seven days, linking
to `/h/<code>/settings/taxes-and-billing` (a Settings address that carries its
hotel, `routes.tsx`; since D27-220 it redirects to Rates and taxes, where the
bank details are - `voucherSettings.test.tsx` pins it).

`systemHealth.ts` (28 September, D27-91 and D27-92) — 1, at `/api/hotels`:

```
GET    /:code/system-health       the owner and an administrator (roleGate READ_RULES,
                                  `role` view, pinned by a test): version, uptime, pool,
                                  database size, disk, traffic for the hour/day/week,
                                  slowest routes, errors and slow queries, each hotel's
                                  business date and last night audit, the last backup
```

The traffic is recorded by `api/src/telemetry.ts` (the core, one middleware in
server.ts) into `telemetry_requests` and `telemetry_events` (its migration:
"telemetry"): per minute, by route PATTERN, errors by kind, slow queries (over
1 s) by value-free SQL name; nothing with an id, a name or a value. Read under
RLS by `app.reads_system_health()`; written and pruned to 180 days only by
`app.record_telemetry()`. The last backup is the last `backup-status` line in
`/var/log/fidato-backup.log` (the 03:00 check's output), read by Connection
health's `readBackupStatus` through its front door (D27-279 (5), D27-284 (5)):
ok/failed, its time, and copied / this disk only (blank on failed with nothing
copied). A log from before that line reads "unknown"; on a machine without the
log the screen says so.

`PATCH /:code/front-desk` (the front desk's hours), which the plan gave to
this service, went to inventory in the server split, beside the Room types
page that holds its form — see inventory's brief.

Every endpoint above has a caller in the web app (checked 15 September).

---

## Data

```
data/admin.ts          375 lines. Roles and the permission matrix, read from
                       src/lib/permissions.ts (listRoles, getMatrix — listRoles
                       has no caller, see Open items); and every write above: create a property or a
                       person, password, access, deactivate, reactivate, amend,
                       close/reopen, home screen; MIN_PASSWORD = 8.
data/adminLists.ts     212 lines. listStaff, roleDescription, listAuditLog,
                       listIntegrations — a fixed list written in the code, not read
                       from anywhere. Split out of the old directory.ts. (getSettings,
                       the fixed rows with the invoice series and POS outlets, went
                       with them on 1 October, D27-220; the server's GET /:code/settings
                       is still there and has no screen.)
data/commissioning.ts  getCommissioning. Split out of the old roomSetup.ts.
data/taxInUse.ts       getTaxInUse — finance's GST rules over HTTP, for the Properties
                       cards (ADM-2, D17-37; Settings shows finance's own GST card).
components/TaxInUse.tsx   TaxInUseRows and taxLine: the GST in use, one row per kind,
                       "-" where unset, "Could not load" on a failed read.
data/groupSettings.ts  getGroupSettings, setGroupName, setGroupLogo, removeGroupLogo,
                       setHotelLogo, removeHotelLogo,
                       logoSrc and useGroupSettings(hotelCode) -> { name, logo } -
                       exported from index.ts for every document: the name for
                       "by <group name>", the logo a data: URL for an <img src> (the
                       hotel's own, else the group's), each null when not set. The
                       cache is per hotel (groupSettingsKey); invalidate by the
                       GROUP_SETTINGS_KEY prefix. NEVER inline the logo as markup: an SVG can
                       carry a script; inside an <img> it runs none of it.
data/systemHealth.ts   getSystemHealth and auditLag - System health's one read, and
                       how far a hotel's day is behind (0 up to date, 1 amber, 2+ red).
components/GroupCard.tsx  Settings' "Group name and logo" card: the name with Change,
                       the logo with Upload/Replace and Remove, for the owner, an
                       admin and the GM. And HotelLogoCard, "This hotel's logo", on
                       the Property tab - the same picker (LogoRow).
data/admin.ts          PropertyProfile and PROPERTY_TYPES (the owner's list: the stored
                       word and its label). EditPropertyDialog (pages/Properties.tsx)
                       draws and sends the profile only when the hotel it is given
                       carries it: Settings' Property tab does, the Properties cards
                       do not, so their Edit cannot clear a field it never showed.
moduleSwitchRoles.ts   MODULE_SWITCH_ROLES (owner, admin) — who sees the switches (D17-36);
                       the server's copy is in api/src/modules/admin/grants.ts.
flows/StaffAdmin.tsx   NewPerson, People, NewProperty.
flows/CommissioningCard.tsx   CommissioningCard (the door's export). ReadyPill,
                       which nothing imported, was deleted on 4 October.
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
  a hotel's row is written by whoever   168_the_hotels_own_profile.sql (D27-213, D27-214):
  manages THAT hotel                    hotels_manage asks app.manages_hotel(id) - the
                                        hotel's Admin can save, a GM of another hotel
                                        cannot (ADM-18); the profile's columns (pin, pan,
                                        website, reservations_phone, property_type,
                                        star_rating, latitude/longitude) and hotel_logos
hotel_setup_steps                       215_setting_up_a_hotel.sql (D27-311): per hotel and
                                        step, completed by hand / later / remind on a day, who
                                        (chosen_by defaults to the signed-in person) and when;
                                        FORCE RLS on app.manages_hotel for reads AND writes;
                                        audited; test-hotel class 'never'. Done-ness is never here.
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

`src/modules/admin/index.ts` exports `CommissioningCard` (no other service
imports it since Room types gave it up, 30 September) and
`useGroupSettings`.

The server's door, `api/src/modules/admin/index.ts`, exports only `mounts`
(`["/api", admin]`), read by `api/src/server.ts`.

---

## Leans on

- **reports** — `getTodaySnapshot` and `getPeriodStatistics` through
  `@/modules/reports`, on one property's page, called with no date: the
  server then uses that property's own business date (D27-308 (1a)).
- **finance**, over HTTP, not by import: every Properties card reads
  `GET /:code/tax` (finance's `tax.ts`) for the GST in use. Settings mounts
  finance's `TaxRulesCard` and inventory's `FrontDeskCard` through their doors.
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
- **PAN, the reservations phone and the website are STORED and printed on no
  document** until the owner says where (D27-214).
- **What the booking voucher prints is set here** (D27-215, migration 169): the
  hotel's bank details (Rates and taxes, `components/VoucherSettings.tsx`,
  `bankDetails.ts`: read AND written only by whoever manages that hotel), its
  house policies (Operations; on the hotel's row, at most 8 of
  200 characters, the reference's four to begin with) and reservations contact
  (Property), and the group's office details (the group card). Every change to
  bank details reaches the group owner's bell (D27-216) - see below. Do not add them to a
  masthead or a footer without that.
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
- **`listRoles`** has no caller (PENDING § 4, KNOWN_UNREACHABLE).
  `listAssignableRoles` and `getAdminSettings` were deleted on 4 October.
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

## Test hotels (D27-296, 10 October) - the server and the database

The owner's twelve answers are row D27-296 of `docs/briefs/decisions-2026-09-27.md`.
One test hotel per real hotel, inside the live system: "Hotel Amrapali · TEST",
code `<CODE>T` (or the first free variant), a copy of the real hotel's whole setup.
Migration "test hotels" (`212_test_hotels.sql`); its checks are
`db/tests/modules/test-hotels.sql` and `api/test/modules/admin/testHotels.test.ts`.

**The mark.** `hotels.test_of` names the real hotel (null for a real one); it never
changes, a test hotel has no test hotel, one per real hotel (a unique index), and a
test hotel carries no GSTIN, PAN or FSSAI number. `app.is_test_hotel(id)` is the one
question everything asks (`app.is_test_hotel_code(code)` where only a code is known).
`staff.test_only`: a person added at a test hotel works only in test hotels, is never
a group administrator, and is never given a real hotel. Only the owner or a group
administrator gives anybody a test hotel or takes it away (`staff_hotels_test_rules`).

**Routes** (`testHotelRoutes.ts`, mounted at `/api` before `admin.ts` so its
`/admin/hotels/:code/:state` does not take them; roleGate `own`):

```
POST /api/admin/hotels/:code/test-hotel    a REAL hotel: 201 { code, name }; 409 if it has one
POST /api/admin/hotels/:code/test-reset    a TEST hotel, { confirm: "RESET" }: 200 { removed }
POST /api/admin/hotels/:code/test-recopy   a TEST hotel, { confirm: "RE-COPY" }: 200 { removed, copied }
```

Group administrators only (403); a wrong word is 400, a real hotel 409; every refusal
carries its sentence as both `reason` and `error`. `GET /api/hotels` gives every
hotel `testOf` (the real hotel's code, null for a real one) and the scope `testOnly`;
`GET /api/admin/hotels` gives `testOf` and `testHotel`; `GET /api/admin/staff` gives
each person `testOnly`, each place in `access` and `rosterAt` its `testOf`.
`POST /api/admin/staff` at a test hotel: group administrators only (403), the person is
made `test_only`, their sign-in account is CREATED and never adopted (an address that
already has one is refused, so nobody's password changes), and an address already on
People is refused with "use Give access". `POST /api/admin/staff/:id/access` to a test
hotel: group administrators only; it never touches a sign-in account.

**Two sides of the group's guests.** guests, companies, booking groups and the offer
answers carry `test_hotel_id`, filled by default from the hotel in the address: the API
puts `/api/hotels/:code`'s code in `app.hotel_code` on every transaction (`db.ts`,
`server.ts`). A row is read on its side only: a test hotel in view shows its own rows
to the people who have it; anything else shows real rows to people with a real hotel
or a group administrator. ID documents, joins, loyalty and the audit of group rows
follow their guest. A trigger on every table with a hotel and a key to a guest, a
company or a group (attached from the catalog) refuses a row on the other side - so a
test bill never counts on a real company's credit. The definer doors (guest search,
Guest 360, the booking suggestions, the same-person pairs, joins, the offer answers,
the loyalty card) answer on the side in view. A test-only person reads the group's
lists and never writes them.

**Nothing leaves** (`api/src/testHotels.ts`). SU, the CRS, rivals' prices and the daily
report emails cannot be set up for a test hotel, and loyalty and the channel manager
cannot be switched on there (database triggers), so their sweeps never meet one.
`sending.ts` refuses a test hotel's message and writes the refusal down as the attempt.
`OUTSIDE` lists every desk button that sends or reaches outside (vouchers, check-in
links, invoices, review requests, report emails, SU and CRS pushes and setup, rivals'
prices, ID photos and the bills' mirror to Drive, door-lock key cards, the accounting
export): a test hotel's request is 409 "This is a test hotel: nothing is sent from it."
before its route runs. The guest's page answers `hotel.test` and never offers DigiLocker
or the ID photo upload for a test hotel. Health alerts look at real hotels only.

**Kept apart.** System health, the bank-details bell and the group activity leave test
hotels out; loyalty's group figures too. The screens' All properties is the web's.

**Documents.** The report PDF, .xlsx and CSV, the View voucher, the tax invoice PDF and
the purchase order say TEST · NOT VALID for a test hotel, and print neither its GSTIN
(it has none) nor the group office's nor the company's.

**Copy, reset, re-copy.** Every table is in one class of `app.test_hotel_classes()`:
setup (copied, new ids, every key remapped - to the copied parent, to the test hotel,
or, for a device, a key or a person, to nothing), trading (cleared by a reset),
never (SU and CRS mappings and traffic, the series, devices, report addresses, bank
details, rivals' prices, what was sent, the audit, who works there) or group. The
property's own columns are classed by `app.test_hotel_hotels_columns()`. A reset clears
the trading tables children first (worked out from the keys each time, every key still
enforced), then the test guests, companies, groups and their documents; rooms empty and
clean, today's business date, the invoice and VAT series from 1; one audit entry
(`TEST_RESET`, `TEST_RECOPY`, `TEST_CREATE`) naming who. The append-only guards let the
deletes through only for a test hotel during its own reset (`app.test_reset_allows`:
a transaction-local setting AND `test_of is not null`) - never a table-wide trigger
switch, never `session_replication_role`. A real hotel's row is never let through.

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
