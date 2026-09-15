# Channel manager

The wire between this system and the booking sites (Agoda, Booking.com,
go-MMT and the rest): rooms and prices out, bookings in.

**NOT CONNECTED. Only a "not connected" status page exists, in the Coming
soon section since 16 September.** Excluded by the owner on 8 September; on 15
September the owner said the channel manager is being defined, to be
finalised on 16 September. Nothing is built here until the owner asks.

**Folder name:** `channel-manager` — the same word in all three places:

```
src/modules/channel-manager/          the status page
api/src/modules/channel-manager/      does not exist — there is no server code for this service
db/tests/modules/channel-manager.sql  does not exist — NEW database checks only, when there is something to check
```

Before any edit: ask the owner. Then claim the service in `HANDOVER.md` →
"Folder claims". Written 15 September 2026 from the code at `880a5b6`.

---

## What it is

Today every booking-site reservation is typed in by hand, and every closed
room is closed by somebody logging in to each site. A channel manager would
push availability and prices from this system to the sites, and pull their
bookings in as bookings. It is the largest gap between this system and a
finished one (`PROGRESS.md`, "What a market-leading HMS has that this does
not"). What exists is a page that says so.

---

## Status — and where that comes from

- **Excluded by the owner, 8 September**: "Channel manager and payment
  gateway: excluded for now" (CHANGELOG 2026-09-08 "Three gates aimed at an
  act…", "Decided by the owner"; `HANDOVER.md` § 4, "earlier").
- **Out of scope until the owner asks** (`PENDING.md` § 3, "Channel manager —
  excluded for now"). Stage 9's five open units are this (`PROGRESS.md`);
  with the CRS bridge they are the 17 of 228 still open (`HANDOVER.md` § 2).
- **In the Coming soon section — the owner's decision, 16 September**: every
  service the system does not have yet, in one section at the foot of the
  menu, for the owner, admins and general managers (`seesComingSoon`). From
  15 September until then it was in nobody's menu (`listed: false`) and a
  search away for anybody holding the `rate` grant.
- **Being defined** — the owner, 15 September: "channel manager things also
  is being defined and also finalised tomorrow" (root `CHANGELOG.md`,
  2026-09-15, "one system"; `docs/HMS-INTEGRATION-PLAN.md` Phase 4).

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Channel manager | `/h/:code/channels` | `pages/ChannelManager.tsx` | owner, admin, GM — the Coming soon section (`seesComingSoon`) |

The entry sits in the Coming soon section, is seen by the owner, admins and
general managers only — the route refuses anybody else — and answers to
"staah", "ota" and "channels" in Find a screen. The page says
"Coming soon", what the connection will do, what it needs first, and lists
the booking sites already recorded as sources — real rows or a dash, never
an invented list of logos.

---

## Server endpoints

None of its own. The page reads the companies list through the guests
service (`listCompanies` → `GET /api/hotels/:code/companies`,
`api/src/modules/guests/directory.ts`) and keeps the ones of kind "OTA".

---

## Data

None — no `data/`, `lib/` or `components/`.

---

## Database

No tables. What a connection would build on, already there:

```
booking_sources.channel_code   082_booking_sources.sql — what a channel manager will send,
                               unique across the group (PENDING § 3)
rates · app.set_rate           033, 053 — every price write goes through app.set_rate,
                               "the channel manager will price dates too" (MEMORY 96)
reservations_freeze_terms      037 — cancellation terms attach however a booking is made,
                               the channel manager included (MEMORY 81)
```

**A new migration needs a number claimed in `HANDOVER.md` first**
(`src/test/migrationNumbers.test.ts`).

---

## Front door

`src/modules/channel-manager/index.ts` exports nothing (`export {};`). Nobody
imports it. There is no server door.

---

## Leans on

- **guests** — `listCompanies` through `@/modules/guests`, on the status page.

If it is ever built it would lean on **inventory** (rooms left and prices —
the rate calendar), **reservations** (bookings in) and **guests** (booking
sources and their commission).

---

## Rules that bind it

- **Nothing is built here until the owner asks** (see Status).
- **What the page says it needs before it can be built** (`pages/ChannelManager.tsx`):
  which channel manager the group pays for — "designed against STAAH"; the
  account and one property id per hotel; a mapping of room names; one rate
  everywhere or a rate per channel. Those are the owner's questions, not the
  code's.
- **Credentials belong in the server's environment, never in a screen or a
  chat** (the same page; `HANDOVER.md` § 5 on `api/.env`).
- **Never invent**: the page lists recorded booking sources or a dash
  (`ChannelManager.tsx` header).
- **The Manager report's City ledger is all dashes until OTA balances are kept
  here** — `manager.ts`: "fills when the channel bridge lands" (PENDING § 6).
  Administration → Integrations lists STAAH as "planned" from a fixed list in
  the code (`src/modules/admin/data/adminLists.ts`).

---

## Open items

Only the owner's decision to start. `PENDING.md` § 3 records the exclusion
and the foundation above; nothing else is open.

---

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
```

The guard: `src/test/boundaries.test.ts` — this folder must keep its
`index.ts` and this `MODULE.md`, and reach other services only through their
`index.ts`. The status page's menu entry is pinned in
`src/components/app/navigation.test.ts` (in nobody's menu).

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
