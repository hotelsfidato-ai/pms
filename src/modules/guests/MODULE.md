# Guests and companies

Who has stayed, who a booking came through, what each source costs in
commission, and the Form III register for foreign guests (Form C until the
Immigration and Foreigners Act 2025; D27-25).

**Folder name:** `guests` — the same word in all three places:

```
src/modules/guests/          the screens, their data calls, their tests
api/src/modules/guests/      the server's routes for this service
db/tests/modules/guests.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

The desk looks up a guest: every stay, grouped by name, repeat guests first,
with possible duplicates shown rather than merged. A manager sees the
companies and agents bookings came through, and what each was worth. The
list of booking sources — Agoda, walk-in, a travel agent — belongs to the
whole group; the commission agreed with each belongs to one property. For a
foreign guest the property owes Form III to the FRRO portal within 24 hours
of arrival, and the departure within 24 hours of leaving (Rule 17 of the
Immigration and Foreigners Rules 2025): the register says who is owed, by
when, and records the portal's number per person once filed there — this
system does not file. A guest's passport or ID and Form III's questions are
asked during check-in and the walk-in, which are front desk's, with this
service's fields (`ForeignGuestFields`); this service keeps and reads them.
Since D27-163 the ID itself is asked once, in `GuestIdFields` (nationality,
document, or a reason for skipping it, Form III and round D's checks): New
booking's one page and front desk's one-page check-in both draw it.

## Screens

Who works from each is `workingMenus` in `nav.ts` (the owner's menu of
15 September). Roles without a working menu see these in the full menu where
their permission allows; anyone whose permission allows can reach them with
Find a screen (Ctrl K).

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| Guests (Bookings) | `/guests` | `pages/Guests.tsx` (`GuestsPage`) | Reception |
| Companies and agents (Bookings) | `/companies` | `pages/Guests.tsx` (`CompaniesPage`) | none |
| Booking sources (Configuration) | `/h/:code/booking-sources` | `pages/BookingSources.tsx` | none |
| Form III (Finance) | `/h/:code/form-c` | `pages/FormC.tsx` | none |

Four addresses, three page files. Menu gates (`nav.ts`): Guests `customer`;
Companies and agents `company`; Booking sources `commission`; Form III
`customer` (the Form III entry: the check-in roles only, D25-38). `/guests`
and `/companies` carry no property in the address;
they read the property in view (`useHotel` in `Guests.tsx`). Form III sits in
the Finance section on purpose — it is filed by the person who bills, and
"burying it under Reports is how a 24-hour deadline gets missed" (`nav.ts`).

Each screen's heading and browser tab are its menu label — the owner's
rule, D17-22 (17 September). `guests.test.tsx` opens all four and fails
if a heading and its `nav.ts` entry disagree. `/companies` read "Booking
sources" until then: GUE-1, fixed.

## Server endpoints

All hang from `/api/hotels`, in three files mounted by
`api/src/modules/guests/index.ts` in this order: `directory`, `formC`,
`bookingSources`. They arrived in the server split of 15 September:
`directory.ts` (its guests part) and `bookingSources.ts` moved (`3ca215d`);
Form C was cut out of the old `invoices.ts` (`1dcf9b7`).

**`api/src/modules/guests/directory.ts`** (the guests part of the old `api/src/routes/directory.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/guests` | everyone who has stayed here, grouped by name; overlapping stays flagged as possible duplicates (cancelled, voided and no-show bookings left out, D27-329 (6)); Stays and Nights leave the same three out (D27-330 (5)) |
| POST | `/:code/guests/:id/vip` | set or clear the VIP mark — it travels with the guest, not the booking (043) |
| GET | `/:code/guests/:id/record` | one guest's record for Edit guest: title, name, phone, email, nationality, address (GU-1; customer:edit, READ_RULES) |
| PATCH | `/:code/guests/:id` | correct it: absent unchanged, blank clears (never name or nationality); refuses an impossible phone, email, country, title (GU-1) |
| GET | `/:code/companies` | each account bookings came through — bookings, room nights, revenue, open balance — grouped by name. The screen ties a row to its record by name (`listCompanyRecords`, the contracts door), for Edit (D27-382), and adds the companies with no booking here |

**`api/src/modules/guests/bookingSources.ts`** (was `api/src/routes/bookingSources.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/booking-sources` | the group's list, with this property's commission (null when none is agreed) |
| POST | `/:code/booking-sources` | add a source for the whole group — refused for a clerk by the table's insert policy (`app.is_manager()`) |
| PATCH | `/:code/booking-sources/:id` | rename it, change its kind or channel code, switch it off |
| PUT | `/:code/booking-sources/:id/commission` | this property's commission for it |

**`api/src/modules/guests/formC.ts`** (cut from the old `api/src/routes/invoices.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/form-c` | every foreign stay with all of Form III, both 24-hour clocks and the numbers filed (`app.form_iii`, 147) |
| POST | `/:code/form-c/:reservationId` | record a filing's portal number, `kind` arrival or departure (a departure only after check-out); one per person |
| PUT | `/:code/form-c/:reservationId/details` | "Complete details": the portal's other boxes, filled in or corrected later; only what is typed is written |

`formIII.ts` holds the rule (`formIIIRefusal`: the law's fields for a foreign
guest; none of the visa for Nepal or Bhutan or an ID skipped) and the savers
(`saveIdentity`, `saveVisit`), exported through `index.ts` for front desk's
check-in, walk-in and check-out.

9 endpoints. The old `directory.ts`'s other endpoints went to inventory
(`roomTypesAndPlans.ts`: room types, rate plans) and administration
(`adminLists.ts`: staff, audit log, settings). Server tests:
`api/test/modules/guests/bookingSources.test.ts`; Form III's in
`api/test/modules/guests/formIII.test.ts` and finance's
`api/test/modules/finance/invoices.test.ts` ("Form C"); the
documents recorded at check-in in `api/test/identity.test.ts`.

## Data

`src/modules/guests/data/`:

| File | What it does |
|---|---|
| `directory.ts` | `listGuests`, `listCompanies`, `setGuestVip` |
| `bookingSources.ts` | the list and its kinds (`SOURCE_KINDS`, `kindLabel`), add, amend, set a commission — null is not zero anywhere in it |
| `formC.ts` | `getFormC` (the register), `recordFormC` (a filing happened, arrival or departure), `completeFormIII` |

## Database

Tables this service owns, and the migrations that made or changed them:

| Table | What it holds | Migrations |
|---|---|---|
| `guests` | one person, belonging to the group — no `hotel_id` | created `004_guests.sql`; `013_policies.sql` (passport and ID fields moved out to `guest_documents`), `015_edge_cases.sql` (a guest is never deleted), `043_indicators.sql` (`is_vip`) |
| `companies` | corporate accounts, agents | created `004_guests.sql`; no endpoint writes to it (grep of `api/src`, 15 September) |
| `guest_documents` | passport or ID number, expiry, visa, address | created `013_policies.sql` (read only at a property with a booking); `014_simulation_fixes.sql` (S2 — any active staff may record one), `026_identity_capture.sql` (who recorded it and when; a number must be present) |
| `form_c_filings` | a Form III filing's portal number, arrival or departure, one per person | created `025_invoices_form_c.sql`; `147_form_iii.sql` (`kind`; unique per stay, kind and number) |
| `form_iii_stays` | what Form III asks about one visit: arrived from, purpose, previous and next place, reference address in India | created `147_form_iii.sql` (`app.form_iii` reads it with `guest_documents` and the audit log's check-in and check-out instants) |
| `booking_sources`, `booking_source_rates` | the group's list of sources; one commission per source per property | created `082_booking_sources.sql` (kinds, `channel_code`, `app.booking_source_label`); `085_walk_in_channel.sql` (`app.walk_in_source`) |

Others write into these directly in SQL: front desk inserts the walk-in's
guest, sets nationality and records the ID at check-in (`guest_documents`);
reservations inserts the guest of every booking. Both stamp
`reservations.booking_source_id` and `commission_pct` (082) from this
service's list. Invoices (finance) and `/reports/c-form` (reports) read
`guest_documents`; the C-Form report also reads `form_c_filings`.

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts`.

## Front door

What `index.ts` exports, and who uses each (grep of `@/modules/guests`,
15 September):

| Export | Used by |
|---|---|
| `listBookingSources` | reservations (`pages/NewBooking.tsx`) |
| `listCompanies` | reservations (`pages/NewBooking.tsx`), channel manager (`pages/ChannelManager.tsx`) |
| `setGuestVip` | front desk (`flows/StayDrawer.tsx`) |
| `ReturningGuest` | reservations (`pages/BookingPage.tsx`) - the CRM's suggestion, 21 September; the consent ticks live on the booking page since D27-176 |
| `stayedWords` | crm (both pages), front desk (`flows/GuestMarks.tsx`) |
| `phoneKey`, `emailKey`, `refusesOffers`, type `NoOffers` | nobody yet - for marketing's gate (`src/modules/crm/MODULE.md`, Requests) |
| `BookingSiteBlacklist` | front desk (`pages/Arrivals.tsx`, `flows/CheckInFlow.tsx`) - CRM-3, a booking site's guest who matches a blacklisted guest, 22 September (D22-8) |

**21 September - the Central CRM, phase 1.** One guest, one record: the
returning-guest suggestion, joins, the blacklist, "no offers" and Guest 360.
Their server routes are in this service, `api/src/modules/guests/people.ts`
(mounted from `index.ts`); the whole of it is described in
`src/modules/crm/MODULE.md`. Two things here changed with it: a booking or a
walk-in no longer ALWAYS inserts a guest - a clerk may confirm an earlier one
(D21-20) - and "total spend" on the Guests screen is read from
`app.stay_charged`, the one definition Guest 360 shares (same figure, one
place).

`listCompanies` is keyed by a name slug, not a company id — right for a list,
wrong as a picker into anything that wants a company (MEMORY 83).

## Leans on

- On the web: no other service's door. The core only — `src/lib/api`,
  `src/data/repositories/http.ts` (`fetchOr`), `BUSINESS_DATE`.
- On the server: `GET /:code/guests` and `GET /:code/companies` read
  reservations and the folio ledger for stay history and revenue; Form III
  reads reservations, room assignments, `guest_documents`, `form_iii_stays` and
  the audit log's check-in and check-out instants through `app.form_iii`
  (147).

## Rules that bind it

- **Channel manager: excluded for now** (owner, 8 September; CHANGELOG
  2026-09-08 (phase 1); PENDING § 3). Its foundation is built here:
  `booking_sources.channel_code`, unique across the group, is what a channel
  manager will send.
- **Every booking records its channel** — both doors, the booking form and
  the walk-in, pick from this list (MEMORY 242; 082, 085). The label for a
  source is written once, `app.booking_source_label` (082; MEMORY 219).
- **No commission is invented** — null means none agreed and shows a dash;
  zero is a statement a manager may make (`bookingSources.ts` header; the
  owner's rule, `HANDOVER.md` § 5).
- **The list is the group's; the commission is the property's** — and the
  screen says so (`bookingSources.ts` header).
- **A guest belongs to the group and is never deleted** (004, 015).
  Duplicates are shown, not merged: "the merge rules are not decided"
  (`directory.ts` header) — ask the owner before building a merge.
- **Menu label, heading and browser tab say the same words**
  (`HANDOVER.md` § 6). "Companies and agents" is the name for `/companies`
  (MEMORY 228), and since GUE-1 was fixed its heading says so too
  (guarded by `guests.test.tsx`).
- **Form C:** the `formC` line of `src/lib/glossary.ts` is the one definition
  — "reported to the FRRO within 24 hours of arrival; anybody whose
  nationality is not Indian needs one"; change the rule, change the line.
  The system records a filing; it does not file (`FormC.tsx`).
- **A claim is not a document** — a passport is recorded, never a tick
  saying one was looked at (MEMORY 40).
- **A shorter menu keeps everything reachable by search** (owner,
  15 September). Reception's working menu carries Guests; the other three
  screens are search-only for reception (`HANDOVER.md` § 3.2).
- **Say Guests, not Pax** (`HANDOVER.md` § 6).
- **Every list has four states** — Guests and Companies and agents say what
  belongs there when empty (CHANGELOG 15 September, step 4; `HANDOVER.md`
  § 6).
- **With the line down** (`src/lib/offline.ts`, core; guarded by
  `src/lib/offline.test.ts`): the VIP mark may be held and sent later; Form C
  is refused; booking sources are not named there, so they are refused too.
- **One main action per screen**: Form C's Save was one of the unmarked
  confirms the guard found (CHANGELOG 15 September, step 2); any new dialog
  must pass `src/components/ui/primaryAction.test.ts`.
- **Production deploys are the owner's** (`HANDOVER.md` § 5).

## Open items

From `PENDING.md`, and one found while writing this brief:

- **`companies` contains channels** — "Walk-in", "Fidato Hotels" and
  "Walk-In" are rows there, still offered as Business source; cleaning them
  up means checking nothing points at them first (PENDING § 6). The demo's
  companies are Agoda, Booking.com, Expedia — channels filed as companies;
  only the owner knows which are real (PENDING § 2).
- **`booking_sources` and `booking_source_rates` are owned by `postgres`,
  not `pms_migrate`** — a migration run as `pms_migrate` that alters them
  will fail with "must be owner" (PENDING § 6).
- **The source-mix report does not show commission totals** — the rates are
  here and stamped on each booking; nothing sums them (PENDING § 6; a
  reports item).
- **Find a screen does not search guests** — screens only (PENDING § 5a).
- **Defect 243's shape in these routes has not been checked** — a refusal
  written below a write keeps the write (PENDING § 2 and § 5).

## Gates

Before the first edit: claim this service with `npm run claim -- guests
"what you are doing"` (from a copy older than that command,
`node "D:\fidato pms\scripts\claim.mjs" claim guests "…"`), and
`npm run release -- guests` when you stop — never in `HANDOVER.md` and
never a committed file. Work in your own worktree with your own
database and ports — how, in `AGENTS.md` ("Before your first write"); the
rules for parallel agents, in `docs/SERVICE-FOLDERS-PLAN.md`.

```
# the PC, in your worktree's folder (PowerShell or Git Bash)
npx tsc -b                      # web types — no output at all
npx vitest run                  # web tests
cd api && npx tsc --noEmit      # server types
cd api && npm test              # server tests — never `npx vitest run` inside api/ (MEMORY 196, 221, 264)

# the PC, Git Bash, in your worktree's folder — needs the local Postgres (HANDOVER.md § 7)
db/tests/run.sh                 # every database check, on a scratch database
db/tests/rerun.sh               # only if you added a migration: it must run twice
```

⚠ A fresh worktree has no copy of the main folder's untracked `.env`;
`AGENTS.md` ("Before your first write") gives your copy a `.env.local` with
`VITE_API_URL` and `VITE_ALLOW_DEV_AUTH=1`. Measured at `c804aa2` in the
worktree this brief was written in: with no env file, `npx vitest run` failed
31 of 204 (19 in `src/App.test.tsx`, 10 in front desk's, 2 in reports');
with only `VITE_ALLOW_DEV_AUTH=1` it still exited 1; with that and
`VITE_DEMO_MODE=1`, 4 of 204 failed, all in `src/App.test.tsx` (not
investigated). A gate's answer is its exit code (MEMORY 274). Never print an
env file.

The guards this service must respect:

- `src/test/boundaries.test.ts` — another service is reached only through its
  `index.ts`; every service folder keeps its `index.ts` and `MODULE.md`.
- `src/test/migrationNumbers.test.ts` — one number, one migration.
- `src/components/app/navigation.test.ts` — pins Reception's working menu;
  sentence case; no two menu entries share a name.
- `src/modules/guests/guests.test.tsx` — each of the four screens is headed
  and tabbed with its own menu label (GUE-1, D17-22).
- `src/components/ui/primaryAction.test.ts` — every dialog declares its main
  action.
- `src/data/repositories/repositories.test.ts` — no exported data function
  without a caller.
- `src/lib/offline.test.ts` — which writes may be held offline.
- `api/test/modules/guests/bookingSources.test.ts` — the list, the
  commission, and who may change them.
- `api/test/modules/reservations/reservationInserts.test.ts` — every
  reservation records a source from this list.

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the guests agent does it.
