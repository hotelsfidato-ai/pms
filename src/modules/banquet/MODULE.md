# Banquet

The hall: which function has it and when, what was agreed for it, and what
the function is eating.

**Folder name:** `banquet` — the same word in all three places:

```
src/modules/banquet/          the screens, their data calls, their tests
api/src/modules/banquet/      the server's routes for this service
db/tests/modules/banquet.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service in `HANDOVER.md` → "Folder claims"
(service, branch, date), read this file, then this folder's `DEFECTS.md` and
`CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`.

---

## What it is

The general manager takes a call — a wedding, a meeting, a birthday — and
writes it in the diary as an **enquiry** for a hall, from a start time to an
end time. Enquiries do not hold the hall; two families can ask about the same
Saturday. **Confirming** takes the hall for that time and opens a bill (a
folio) for the function; a second confirmation that overlaps is refused and
names the function in the way. Food is optional: a package at a per-head
rate, dishes from the restaurant, both, or nothing. A cancellation needs a
reason. "Halls and packages" is where the property enters its halls and its
catering packages — nothing is shipped.

---

## Screens

The menu section is **Banquet**. It is absent at a property whose `banquet`
module is off (`navigation.ts`, section `banquet`, `module: "banquet"`).

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Diary | `/h/:code/banquet` | `pages/Banquet.tsx` | none |
| Halls and packages | `/h/:code/banquet/setup` | `pages/BanquetSetup.tsx` | none |
| — (not in the menu) one function | `/h/:code/banquet/:id` | `pages/BanquetEvent.tsx` | opened from the diary |

No working menu lists either entry. Owner, admin, GM, hotel manager, finance
and read-only see them where their permissions allow: the Diary needs the
`reservation` grant, Halls and packages the `room_config` grant (the default
test, no `canSee`). Everybody else reaches them by Find a screen, if allowed.

---

## Server endpoints — 12

The code is in `api/src/modules/banquet/banquet.ts` (712 lines; moved 15
September); the door `index.ts` mounts it at `/api/hotels`. Every route passes the module gate
first (`app.module_enabled(hotel, 'banquet')`) and is refused with a sentence
when the hall is switched off.

```
diary      GET    /:code/banquet                              every hall over a window, with its functions
function   GET    /:code/banquet/events/:id
           POST   /:code/banquet/events                       register an enquiry
           POST   /:code/banquet/events/:id/confirm           takes the hall; opens the folio
           POST   /:code/banquet/events/:id/cancel            needs a reason
           PATCH  /:code/banquet/events/:id                   amend, including the agreed price
catering   POST   /:code/banquet/events/:id/catering          a package or a named course, per head
           DELETE /:code/banquet/events/:id/catering/:lineId
setup      GET    /:code/banquet/setup                        halls and packages
           POST   /:code/banquet/venues
           PATCH  /:code/banquet/venues/:id
           POST   /:code/banquet/packages
```

Every endpoint has a caller in `data/banquet.ts`. There is no endpoint to
amend or retire a package.

---

## Data

```
data/banquet.ts   308 lines. The diary, one function, the setup; register,
                  confirm, cancel, amend; add and remove catering; add and
                  amend a hall; add a package. Twelve functions, one per endpoint.
```

No `lib/`, `components/` or `flows/` in this folder; the pages carry their own
dialogs.

---

## Database

```
banquet_venues, banquet_events          060_banquet.sql
  a time range (tstzrange), not a date; registered_by and ends_at required;
  agreed_amount NULL means unpriced; only a CONFIRMED event holds the hall —
  exclusion constraint be_no_double_booking; a cancellation needs a reason;
  app.confirm_banquet_event, app.banquet_conflicts, app.banquet_calendar;
  folios.event_id, and folios_belongs_to_one widened to three kinds of bill
banquet_packages, banquet_event_packages  061_banquet_food.sql
  rate_per_head NULL until typed, snapshotted onto the function;
  app.banquet_event_total — an unpriced part makes the total NULL and names itself;
  pos_orders.event_id — a restaurant bill charged to a function (see BQ-1)
  idempotency key on banquet_events       062_idempotency.sql — an enquiry sent twice offline makes one
```

Also relied on: `hotel_modules` (041 — the `banquet` switch, off until turned
on), a `banquet` tax kind in `tax_rules` (067, finance's), and
`066_delete_untraded_property.sql`, which counts banquet events when deciding
whether a property has ever traded.

**A new migration needs a number claimed in `HANDOVER.md` first.**
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. The highest today is 089.

---

## Front door

`src/modules/banquet/index.ts` exports nothing yet (`export {};`). No other
service imports this one. The server's door, `api/src/modules/banquet/index.ts`,
exports only `mounts`, read by `api/src/server.ts`.

---

## Leans on

No other service's door is imported by this folder (checked 15 September).
The plan's "leans on the POS menu (banquet food, 061)" is a database link, not
code:

- **finance**: confirming opens a folio for the function (`folios.event_id`,
  060), and a `banquet` tax kind is finance's (067).
- **pos**: `app.banquet_event_total` adds settled restaurant bills whose
  `pos_orders.event_id` is this function (061) — but nothing sets that column
  (BQ-1).
- **admin**: the `banquet` switch lives on Administration → Settings → Modules.

---

## Rules that bind it

- **The owner turned banquet on for Akkalkot** on 8 September (CHANGELOG
  2026-09-08 "Three gates…", "Decided by the owner"). Until then the switch
  was disabled with "Not built yet" (MEMORY 214).
- **The group's own description shapes the model** (quoted in
  `060_banquet.sql` and `061_banquet_food.sql`): a hall is booked "till when";
  it is the GM's responsibility to register it; "no fixed price but also keep
  the option to set default price"; food is "situation to situation", both
  package and restaurant open.
- **No default prices, no default halls, no default packages**
  (`HANDOVER.md` § 5; 060, 061). A hall's `default_rate` is NULL until
  somebody types it and is only offered on the booking form; an unpriced
  function shows a dash and its total is NULL with a sentence saying what is
  missing, never a short total.
- **A hall cannot be sold twice** — `app.confirm_banquet_event` refuses and
  names the function in the way; the exclusion constraint stands behind it
  (060; `banquet.ts` header). An enquiry never holds the hall.
- **Offline**: an enquiry is queued; confirming is refused, because two desks
  offline could both take the hall (`src/lib/offline.ts`).
- **The switch belongs to the GM**: only the property's GM or a group
  administrator may turn banquet on or off (084; MEMORY 250). The API refuses
  banquet routes when it is off, independently of the menu (041).
- **"Cancel the function" is a `danger` button** (CHANGELOG 2026-09-15 step 2).
  A new dialog must declare its main action —
  `src/components/ui/primaryAction.test.ts` (`HANDOVER.md` § 3.1).
- **Every list draws four states** — loading, failed, empty, full
  (`HANDOVER.md` § 6).
- **The menu label, the page heading and the browser tab say the same words**
  (`HANDOVER.md` § 6) — the Diary does not yet (BQ-2).
- **Inside `withSession`, a refusal is a commit** — every refusal before the
  first write, or throw (MEMORY 243). `banquet.ts` has not been checked for
  this (PENDING § 2).
- **Tests clean up only what they made** — `banquet.test.ts` once deleted a
  real function somebody had just entered (MEMORY 120).

No Start here card and no glossary line names anything in this service.

---

## Open items

`PENDING.md` lists nothing for banquet by name. Found while writing this brief
(15 September):

- **BQ-1** — the till cannot charge a function: nothing sets
  `pos_orders.event_id`, so the function's "From the till" line can only be
  zero. `PROGRESS.md` says the till can do it. The change would be in the
  restaurant's till — a request to `pos`, after asking the owner whether it is
  wanted.
- **BQ-2** — the Diary's page heading and tab say "Banquet", not "Diary".
- The general rule in PENDING § 2: refusals after a write have not been
  audited in this service's routes.

---

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit     clean
          cd api && npm test             a scratch database; never `npx vitest run`
                                         inside api/ (MEMORY 196, 221, 264)
          cd api && npm run strip-check  the server's loader can parse every file (MEMORY 209)
database  db/tests/run.sh                a scratch database, dropped after
```

The guard this folder must respect: `src/test/boundaries.test.ts` — another
service reaches this one only through `index.ts`, and this one reaches others
only through theirs.

Where the checks are today: `api/test/banquet.test.ts` (the module gate, the
halls, registering a function, the money, cancelling) — moving to
`api/test/modules/banquet/`; `src/App.test.tsx` "the module switches";
`db/tests/suite.sql` group `banquet` (frozen — new checks go in
`db/tests/modules/banquet.sql`, which does not exist yet).

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
