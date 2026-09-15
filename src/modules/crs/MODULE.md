# CRS connection

Bookings arriving in this system from the Fidato CRS.

**NOT BUILT. Nothing is written here until the owner asks.** This folder
holds this brief, an empty front door (`index.ts`), and its own
`CHANGELOG.md` and `MEMORY.md` — no screens, no menu entries, no routes, no
server code.

**Folder name:** `crs` — the word the other two places will use if it is
ever built:

```
src/modules/crs/          this brief; screens, if the owner asks for any
api/src/modules/crs/      does not exist
db/tests/modules/crs.sql  does not exist
```

---

## What it would be

The Fidato CRS — the group's central reservation system — is a separate
application with its own code (`D:\fidato crs`; this project's
`src/components/ui/` was ported from it — root `MEMORY.md`, "Working with the
CRS library"). The connection would let a booking made in the CRS arrive
here as a booking: the guest, the room type, the nights and the rate,
without anybody retyping it at the desk. Administration → Integrations
describes it as this group's own properties appearing in the CRS, with the
status "planned" (`src/modules/admin/data/adminLists.ts`, a fixed list).

---

## Status, and where it comes from

- **Waiting on the CRS's API documents.** `HANDOVER.md` § 2: of the 228
  units of go-live scope, the 17 open are the channel manager and "the CRS
  bridge (waiting on its API documents)". `PROGRESS.md`: "CRS bridge
  (stage 11, twelve — after go-live, waiting on the API docs)", and on the
  stage board "now IN scope, after go-live". `docs/SERVICE-FOLDERS-PLAN.md`:
  "waiting on the CRS's API documents".
- Not to be confused with the **CRS voucher** `FH-2026-00002`, which is the
  template for this system's printed documents (`HANDOVER.md` § 3.5,
  staff-first phase 3). That is a document layout, not this connection.

---

## What it would lean on

- **reservations** — a booking from the CRS becomes a booking here, and must
  record where it came from: every statement that creates a reservation writes
  `booking_source_id` (`api/test/reservationInserts.test.ts`; root MEMORY 242).
- **inventory** — which rooms are left and what they cost
  (`GET /:code/inventory`, `app.tariff_for`, `app.set_rate`).
- **guests** — the guest record, and the booking source the CRS is filed as.
- The **booking engine** may belong in the CRS instead of here
  (`booking-engine/MODULE.md`).

---

## Rules that will bind it

- **Ask the owner before building anything** — their standing rule
  (`HANDOVER.md` § 3 and § 5).
- **Claim the folder** in `HANDOVER.md` → "Folder claims" before the first
  edit (`docs/SERVICE-FOLDERS-PLAN.md`, rules for parallel agents).
- **Credentials live in the server's environment** (`api/.env`), never in the
  repo, a screen or a chat (`HANDOVER.md` § 5).
- **No default prices; never invent a figure** (`HANDOVER.md` § 5).
- **A new migration needs a number claimed in `HANDOVER.md` first**
  (`src/test/migrationNumbers.test.ts`).
- Reach other services only through their `index.ts`
  (`src/test/boundaries.test.ts`).

---

## Gates

`npx tsc -b` and `npx vitest run` — `src/test/boundaries.test.ts` fails if
this folder loses its `index.ts` or this `MODULE.md`.

---

## Requests from other services

None. To ask for something here, add a line below — date, your service, what
you need and why — and raise it with the owner; nothing is built here
unasked.
