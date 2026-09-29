# Room systems

Connections to the devices in the rooms. This build is door locks only:
room controls are not built (card-slot energy savers, D27-182), and the
phone system, minibar and TV are not in it.

**KEY CARDS: BUILT AGAINST A STAND-IN, 30 September (D27-178). Not
connected to any lock.** The owner has not named 5 Elements' lock system;
nothing is switched on until the vendor's details exist. Until 16 September
this was the `equipment` service's Coming soon page, "Hotel equipment"
(decision S2 moved it here).

```
src/modules/room-systems/          KeyCards.tsx (the panel), data/keys.ts, the Coming soon page
api/src/modules/room-systems/      locks.ts (the driver and its stand-in), keys.ts (routes)
db/tests/modules/room-systems.sql  the key-card record's database rules
db/migrations/175_key_cards.sql    numbered for now; the master renumbers at merge
```

---

## Key cards

- **The record** (`key_cards`, append-only): one row per act, issue or
  cancel, for a stay and a room, with the number of cards, when they stop,
  why (check-in, new cards, lost, check-out, room change), whether the lock
  system accepted it and its own words, and who (always the signed-in person).
  The cards that open a door now are the stay's last accepted row, when it
  is an issue.
- **Cut cards**: `POST /api/hotels/:code/stays/:id/keys` `{ cards, lost? }`.
  The room is the one the stay holds tonight and the validity is the
  booking's departure date at the property's check-out time, both decided on
  the server. Only a checked-in guest. A lost card is a cancel then a new
  issue.
- **The record**: `GET /api/hotels/:code/stays/:id/keys`.
- **Cancelling** is front desk's check-out, move and exchange, one call each
  to `cancelStaleKeys` (the front door): it cancels the cards when they no
  longer open the room the stay holds tonight. A lock that refuses is
  recorded as not done and never stops a check-out.
- **The panel**, `KeyCards`, in the stay drawer for a guest in the house.
  Draws nothing where no lock is connected and no card was cut.

## The lock system — one driver

`api/src/modules/room-systems/locks.ts`. A driver is two acts, FIAS's KR and
KD (Oracle IFC8 FIAS Specification 2.20.25, May 2022). Switched on by the
server's settings, never a screen:

```
ROOM_SYSTEMS_DRIVER   "stand-in" is the only driver (refused when NODE_ENV=production)
ROOM_SYSTEMS_HOTELS   the property codes it serves, e.g. 5EL
```

Connecting the real vendor is one more entry in `DRIVERS`. What each kind
of lock needs from the owner (research of 30 September):

- **Cloud API** (ASSA ABLOY Vostio, Onity CloudConnect, dormakaba Ambiance
  Cloud, TTLock's cloud): the vendor account and API credentials, and the
  encoder's name. No PC at the hotel.
- **A lock server at the hotel** (Salto Space, VingCard Visionline, Saflok,
  Onity HT24 over TCP, speaking FIAS or the vendor's local web API): the
  vendor's PMS-interface licence, the server's address, network encoders
  (Salto: USB encoders cannot be used with a PMS), and an always-on PC for a
  small bridge program that connects out to our API.
- **Desk software with a USB encoder** (most budget brands sold in India:
  Orbita, Adel, Be-Tech, Godrej Catus, Ozone; TTLock's encoder DLL): the
  vendor's SDK under their licence, and the desk PC for the same bridge.

## The owner's decisions (D27-182, 30 September)

- **Not at the pilot.** The stand-in only, and switched off: the live
  server sets neither setting, so no panel shows and nothing is recorded.
- **Who:** whoever may check a guest in (owner, Admin, GM, hotel manager,
  reception), a lost card too; the lost-card dialog says to check the ID.
- **How many:** 1 to 4 cards at once, starting at the number of adults.
- **Room controls: none.** 5 Elements has card-slot energy savers, which no
  system reaches. Nothing is built for energy saving or do-not-disturb.
- **The menu** keeps "Not built yet"; the page says "Built; waiting for the
  hotel's lock system".
- **Still open, Q1:** which lock 5 Elements has. The owner is sending
  photos of a lock, the encoder and the lock software's About screen.

## Outside this folder (the master's yes, T2)

`api/src/server.ts` (the mount), `api/src/roleGate.ts` (two lines, pinned
in `api/test/roleGate.test.ts`), front desk's `operations.ts` (check-out,
move) and `stayExtras.ts` (exchange), one `cancelStaleKeys` call each, and
`StayDrawer.tsx` (the panel). The migration is numbered 175 for now.
