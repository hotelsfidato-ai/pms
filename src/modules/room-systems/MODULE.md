# Room systems

Connections to the devices in the rooms: door locks (Onity, Salto, Hafele), the
phone system and call billing, the minibar and the TV, energy management.

**NOT BUILT. A Coming soon page only.** Until 16 September this was the
`equipment` service's Coming soon page, called "Hotel equipment". The owner then
gave the word **Equipment** to the register of everything durable in the hotel
(decision S2, `docs/STOCK-AND-EQUIPMENT-PLAN.md`), and these device connections
moved here, under their own name, unchanged.

**Folder name:** `room-systems`:

```
src/modules/room-systems/          the Coming soon page
api/src/modules/room-systems/      does not exist
db/tests/modules/room-systems.sql  does not exist
```

---

## What it would be

- **Key cards at check-in**, cut for the room assigned and cancelled at check-out.
- **Calls on the bill** — calls from a room charged to the stay.
- **Minibar and TV** — minibar use charged to the room.

## Where it stands

"Worth doing when a property asks. None of it blocks anything" (`PROGRESS.md`,
items 20–23). The folio already has `minibar` and `telephone` categories
(`006_folio.sql`); the desk's charge list (`src/lib/rules.ts`,
`CHARGE_CATEGORIES`) offers neither.

## Before anything is built

Which hotel wants which, the brands installed, and the makers' connection
documents. Nothing here starts until the owner names a property and a system.
