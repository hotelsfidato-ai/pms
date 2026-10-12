# Banquet

The hall: which function has it and when, what was agreed for it, and what
the function is eating — from a package, or from the restaurant.

**Folder name:** `banquet` — the same word in all three places:

```
src/modules/banquet/          the screens, their data calls, their tests
api/src/modules/banquet/      the server's routes for this service
db/tests/modules/banquet.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service in your copy's folder with
`npm run claim -- banquet "what you are doing"` (release it with
`npm run release -- banquet`), read this file, then this folder's `DEFECTS.md`
and `CHANGELOG.md`, and `docs/briefs/banquet.md`. Written 15 September 2026
from the code at `880a5b6`; brought up to date 17 September.

---

## What it is

The general manager takes a call — a wedding, a meeting, a birthday — and
writes it in the diary as an **enquiry** for a hall, from a start time to an
end time. Enquiries do not hold the hall; two families can ask about the same
Saturday. **Confirming** takes the hall for that time and opens a bill for the
function; a second confirmation that overlaps is refused and names the
function in the way. Food is optional: a package at a per-head rate, orders
from the restaurant, both, or nothing. A cancellation needs a reason. "Halls
and packages" is where the property enters its halls and its catering
packages — nothing is shipped.

**Restaurant food on a function's bill (D17-21, 17 September).** The till
attaches an order to a function (`pos_orders.event_id`); the function's screen
lists every open and settled order attached to it, and the total counts the
settled ones. Banquet built its half first — the list, and the rule for which
functions the till may offer. **The till side is the POS chat's, and not built
yet.**

---

## Screens

The menu section is **Banquet**. It is absent at a property whose `banquet`
module is off (`navigation.ts`, section `banquet`, `module: "banquet"`).

| Menu name | Heading | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|---|
| Diary | Diary | `/h/:code/banquet` | `pages/Banquet.tsx` | none |
| Halls and packages | Halls and packages | `/h/:code/banquet/setup` | `pages/BanquetSetup.tsx` | none |
| — (not in the menu) one function | the function's title | `/h/:code/banquet/:id` | `pages/BanquetEvent.tsx` | opened from the diary |

No working menu lists either entry. Owner, admin, GM, hotel manager, finance
and read-only see them where their permissions allow: the Diary needs the
`reservation` grant, Halls and packages the `room_config` grant (the default
test, no `canSee`). Everybody else reaches them by Find a screen, if allowed.

**Every screen draws four states** (BQ-3): loading; a failed read, told apart
as refused (the server's own sentence — "This property has no banquet hall…"
when the module is off), unreachable, or failed, with Try again; empty; full.
A refresh that fails over something already shown keeps it, under a "Not up to
date" line. The words are the restaurant's (POS-4), from
`components/ReadProblem.tsx`.

---

## Server endpoints — 16

The code is in `api/src/modules/banquet/banquet.ts` and `attach.ts`; the door
`index.ts` mounts it at `/api/hotels`. Every route passes the module gate first
(`app.module_enabled(hotel, 'banquet')`) and is refused with a sentence when
the hall is switched off — **except `attachable`**, which answers
`{ enabled: false, functions: [] }` there, because the till asks it at every
property.

```
diary      GET    /:code/banquet                              every hall over a window, with its functions
function   GET    /:code/banquet/events/:id                   includes restaurantOrders (D17-21)
           POST   /:code/banquet/events                       register an enquiry
           POST   /:code/banquet/events/:id/confirm           takes the hall; opens the bill
           POST   /:code/banquet/events/:id/cancel            needs a reason
           PATCH  /:code/banquet/events/:id                   amend, including the agreed price
bill       POST   /:code/banquet/events/:id/bill              the hall and courses onto the bill (banquet GST); function Completed
           POST   /:code/banquet/events/:id/payments          an advance, or settling (idempotency-key)
           POST   /:code/banquet/events/:id/invoice           finance's tax invoice, SAC 996334 / 997212
catering   POST   /:code/banquet/events/:id/catering          a package or a named course, per head
           DELETE /:code/banquet/events/:id/catering/:lineId
setup      GET    /:code/banquet/setup                        halls and packages
           POST   /:code/banquet/venues
           PATCH  /:code/banquet/venues/:id
           POST   /:code/banquet/packages
till       GET    /:code/banquet/attachable                   the functions an order may be attached to now
```

Every endpoint has a caller in `data/banquet.ts`. There is no endpoint to
amend or retire a package.

**Names are labels, never joins** (BQ-7). "Registered by", "Confirmed by" and a
course's "Added by" come from `app.colleague_name` (096), not from a join to
the row-secured `staff` table — the join made a function the owner registered
open as "No such function" for the GM.

---

**The function's bill (BQ-9, 28 September; D27-132 to D27-138).** The three
bill routes go through finance's per-bill door (`postFolioCharge`,
`takeFolioPayment`, `issueFolioInvoice`, `folioBalance`); banquet adds no tax
up. Who: `api/src/roleGate.ts` - owner, admin and GM (`reservation` approve);
the invoice also the accountant (`invoice` approve). The function's GET
carries `taxWarning` (D27-124), `bill` and `invoice`. Once billed (status
`completed`) the price, courses, times and cancelling are refused.

## Data

```
data/banquet.ts   The diary, one function, the setup; register, confirm, cancel,
                  amend; add and remove catering; add and amend a hall; add a
                  package; the functions an order may be attached to.
                  Thirteen functions, one per endpoint. The three reads THROW
                  on failure (BQ-3) — never null.
components/ReadProblem.tsx   refused / unreachable / failed, and the two
                  components that draw them. A named copy of the till's; see
                  Requests.
```

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
  app.banquet_event_total — an unpriced part makes the total NULL and names itself,
  and settled restaurant orders are added; pos_orders.event_id
  idempotency key on banquet_events       062_idempotency.sql — an enquiry sent twice offline makes one
app.colleague_name                      096 (the master's) — the names on the function
```

Also relied on: `hotel_modules` (041 — the `banquet` switch, off until turned
on), a `banquet` tax kind in `tax_rules` (067, finance's), and
`066_delete_untraded_property.sql`, which counts banquet events when deciding
whether a property has ever traded.

**A new migration** takes the next number after cp6's highest when the file is
written, and the master renumbers at merge (`docs/briefs/README.md`).
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. Banquet has none of its own since 061.

---

## Front door

**Website — `src/modules/banquet/index.ts`**, for the till (D17-21):

```
getAttachableFunctions(hotelCode) → { enabled, businessDate, functions: AttachableFunction[] }
type AttachableFunction  { id, reference, title, venueName, hostName, startsAt, endsAt }
```

**Server — `api/src/modules/banquet/index.ts`**: `mounts`, and

```
attachableFunctions(client, hotelId)            the same list, inside a session
whyNotAttachable(client, hotelId, eventId)      null, or the sentence to refuse with
```

**The rule, the owner's (17 September):** a CONFIRMED function at this
property, its bill OPEN, running on the business date from its first day to
its last, in the property's own time zone (a function ending at midnight has
ended). The till's screen shows the list as given — no second filter — and the
till's server asks `whyNotAttachable` **before its first write** and refuses
with the sentence.

---

## Leans on

- **finance**: confirming opens a bill for the function (`folios.event_id`,
  060), and a `banquet` tax kind is finance's (067). The bill's charges,
  payments, figures and tax invoice are finance's per-bill door (round A,
  28 September).
- **pos**: since D27-133 an order settled to a function is posted onto the
  function's bill by the till, as a room charge is.
- **pos**: the function's screen reads `pos_orders` (by `event_id`),
  `pos_outlets` (the name, a left join) and `app.pos_order_total` — the same
  database link 061's total already had. No POS code is imported. Setting
  `event_id` is the till's, and not built yet.
- **admin**: the `banquet` switch lives on Administration → Settings → Modules.
- **the master**: `app.colleague_name` (096).

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
  (`HANDOVER.md` § 5; 060, 061). An unpriced function shows a dash and its
  total is NULL with a sentence saying what is missing, never a short total.
- **A hall cannot be sold twice** — `app.confirm_banquet_event` refuses and
  names the function in the way; the exclusion constraint stands behind it.
- **Offline**: an enquiry is queued; confirming is refused, because two desks
  offline could both take the hall (`src/lib/offline.ts`).
- **The switch belongs to the owner and an Administrator (D17-36)**: only they
  may turn banquet on or off (admin/moduleSwitches.ts); the GM is refused.
- **"Cancel the function" is a `danger` button.** A new dialog must declare
  its main action — `src/components/ui/primaryAction.test.ts`.
- **The heading is the menu name** (D17-22). The Diary is headed "Diary".
- **The function's account is a "bill"** on these screens (BQ-4, 17 September).
- **Dates and times through `src/lib/format.ts`** (BQ-5): "14 Nov 2026,
  6:00 PM". Sentences the SERVER writes (the clash warning, the confirm
  refusal) still print their own times — see `DEFECTS.md`.
- **Inside `withSession`, a refusal is a commit** — every refusal before the
  first write, or throw (MEMORY 243). The existing routes have not been
  audited for it (PENDING § 2); `attach.ts` only reads.
- **Tests clean up only what they made** — `banquet.test.ts` once deleted a
  real function somebody had just entered (MEMORY 120).

No Start here card and no glossary line names anything in this service.

---

## Open items

- ~~**BQ-1, the till's half**~~ — done by the POS chat on 17 September
  (`f671b19`): the till attaches an order to one of
  `getAttachableFunctions`' functions and asks `whyNotAttachable` on the
  server. `DEFECTS.md` BQ-1, now under Fixed.
- ~~BQ-6~~ — fixed 28 September (round E): a per-property lock and no cut.
- Correcting a billed function's figures after a credit note, and refunding
  a cancelled function's advance: not built (DEFECTS BQ-9, "Left open").
- The general rule in PENDING § 2: refusals after a write have not been
  audited in this service's routes.

---

## Gates

```
web       npx tsc -b --force                 clean
          npx vitest run                     all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit         clean
          cd api && npm test                 a scratch database; never `npx vitest run`
                                             inside api/ (MEMORY 196, 221, 264, 277)
          cd api && npm run strip-check      the server's loader can parse every file (MEMORY 209)
database  bash db/tests/run.sh               a scratch database, dropped after
```

Where the checks are:

```
api/test/modules/banquet/banquet.test.ts   the module gate, halls, registering, the money, cancelling
api/test/modules/banquet/attach.test.ts    which functions an order may attach to; the bill's orders
api/test/modules/banquet/names.test.ts     a function opens for the GM and a clerk, with names (BQ-7)
src/modules/banquet/banquet.test.tsx       the heading, dates, failed reads, the bill's orders, the door
src/App.test.tsx                           "the module switches"
db/tests/suite.sql                         group `banquet` (frozen)
```

---

## Requests

**To the master (17 September, the banquet chat):**

1. **`getAttachableFunctions` and Rule 2b.** `src/data/repositories/
   repositories.test.ts` ("every function on the seam is called by
   something") fails on this branch naming `getAttachableFunctions`, and it is
   right: nothing reaches it until the POS chat's till imports it. Either add
   it to `KNOWN_UNREACHABLE` at the merge, with D17-21 as the reason (the
   shrink-only test then insists it comes off when POS imports it), or merge
   banquet and the POS half together. Not worked around here.
   **Answered by the POS half (17 September):** `src/modules/pos/components/
   FunctionPicker.tsx` calls it, and it is not in `KNOWN_UNREACHABLE`
   (checked 25 September).
2. **One `ReadProblem` for everybody.** The owner wanted the banquet screens to
   say a failed read the restaurant's way, so `components/ReadProblem.tsx` is a
   named copy of `src/modules/pos/components/ReadProblem.tsx`. Moving one copy
   into `src/components/ui/` would let both services — and any other — use it.

**From other services:** none yet. To ask for a change here, add a line —
date, your service, what you need and why.
