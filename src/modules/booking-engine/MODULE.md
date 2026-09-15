# Booking engine

Direct bookings from the hotel's own website: a guest picks dates, sees the
price and books, with no booking site in between.

**NOT BUILT. A Coming soon page only.** **It may belong in the Fidato CRS instead of here — ask the owner first.** The owner chose on
16 September to give every service the system does not have a Coming soon
page, in one section at the foot of the menu for the owner, admins and
general managers. This folder holds this brief, an empty front door
(`index.ts`), its own `CHANGELOG.md` and `MEMORY.md`, and the page with
its menu entry and address — no working feature, no server code.

**Folder name:** `booking-engine` — the word the other two places will use
if it is ever built here:

```
src/modules/booking-engine/          this brief, and the Coming soon page (menu entry, address)
api/src/modules/booking-engine/      does not exist
db/tests/modules/booking-engine.sql  does not exist
```

---

## What it would be

Nothing in this system takes a reservation from a guest; every booking is
entered by staff (`PROGRESS.md`, "What a market-leading HMS has that this does
not", item 2: "direct bookings off the property's own site"). A booking
engine is how direct bookings — which pay no commission — would grow.

---

## Status, and where it comes from

- **Not built; may belong in the CRS — ask first.** `docs/SERVICE-FOLDERS-PLAN.md`:
  "Booking engine | `booking-engine` | not built; may belong in the CRS — ask
  first". The Fidato CRS is a separate application (see `crs/MODULE.md`).
- `PROGRESS.md` lists it among what competitors bundle — a comparison, not
  a decision by the owner.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Booking engine | `/coming-soon/booking-engine` | `pages/BookingEngine.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The page is the shared Coming soon page (`src/pages/ComingSoon.tsx`) with
this service's words: what it will do, what it needs, where it stands.
Find a screen answers to "direct booking", "website booking", "book now", "web booking". Anybody else who types the address is
refused ("This page is not part of your role").

**What the page says it needs before it can be built** — the owner's
questions, not the code's:

1. Whether it lives here or in the Fidato CRS.
2. Each hotel's website, and who looks after it.
3. Online payments, if a deposit should hold the room, and guest messages for the confirmation.

---

## What it would lean on

- **inventory** — rooms left and the price of a stay: `GET /:code/inventory`
  and `GET /:code/tariff` (`app.tariff_for`, extra persons included).
- **reservations** — making the booking. Every statement that creates a
  reservation must write where it came from (`booking_source_id`);
  `api/test/reservationInserts.test.ts` fails on one that does not — a third
  door would be caught there, not in production (root MEMORY 242).
- **guests** — the guest, and "the hotel's website" as a booking source.
- **payments** — a deposit to hold the room (parked).
- **guest-messaging** — the confirmation (not built).

---

## Rules that will bind it

- **Ask the owner first**, including whether it belongs here or in the CRS
  (`docs/SERVICE-FOLDERS-PLAN.md`; `HANDOVER.md` § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first edit.
- **No default prices; a missing price is a dash, never a zero** — a room
  nobody has priced cannot be offered at an invented rate (`HANDOVER.md` § 5;
  root MEMORY 63).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`); reach other services only through
  their `index.ts` (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b` and `npx vitest run` — `src/test/boundaries.test.ts` fails if
this folder loses its `index.ts` or this `MODULE.md`.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
