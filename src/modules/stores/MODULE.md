# Store

What the property keeps on its shelves — rice, gas, linen, soap — and where
each of it went.

**Folder name:** `stores` — the same word in all three places:

```
src/modules/stores/          the screens, their data calls, their tests
api/src/modules/stores/      the server's routes for this service
db/tests/modules/stores.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: `npm run claim -- stores "what you are doing"` in your
copy, then read `docs/briefs/stores.md`, this file, this folder's `DEFECTS.md`
and `CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`;
permissions brought up to date 16 September (STO-1).

"Inventory" in this system means rooms and prices — that is the `inventory`
service. The shelves are the **Store**, and stock. Since 16 September the
Store's menu entry sits in the section **Store and equipment**, and it has its
own grant, `stock` (`docs/STOCK-AND-EQUIPMENT-PLAN.md`).

---

## What it is

The store keeper adds the things the hotel keeps, each with the unit it is
counted in. Every delivery is a **receipt** with what it cost; stock given to
the kitchen or a floor is an **issue**; spoiled stock is **wastage**; a
counted correction is an **adjustment**; stock sent back is a **return**. The
screen shows what is on hand and what it is worth, and each item's history. A
wrong entry is never edited — it is **reversed** by a row that points at it,
and both stay. A list can be imported from a file.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Store | `/h/:code/stores` | `pages/Stores.tsx` | housekeeping, stores |

- The entry needs the `stock` grant (`resource: "stock"`, no `canSee`), and
  the route is guarded by `RequireAccess` with the same resource (STO-1).
  Reception, the till and the revenue manager hold none: no entry, and the
  address says "This page is not part of your role".
- **Who sees what on the page** (`can(role, …, "stock")`):
  `create` — **Receive · Issue · More** on each item (More: Waste, Return to
  supplier, History), Import, and **Add an item**, the page's one primary
  action;
  `edit` — also **Correct the count** in More, and Undo in History;
  view only (housekeeping, chef, accountant, viewer) — one sentence, *"You can
  see the store. Receiving, issuing and adding items is for the Inventory
  Manager, hotel manager or GM."*, a History button, and no change buttons (the
  owner's choice, 16 September). Without `edit`, History says who may undo
  instead of offering it.
- **The item card** (STO-3): the name on its own line, then On hand and Worth,
  then the buttons; the buttons join the name's row only from `xl`. On a phone
  Receive and Issue drop their arrows so the three fit one row at 360px.
- **Undo asks first** (STO-6) — "Undo this delivery of 3 cylinder? It cannot be
  taken back …" — and an undo row reads "Undo of a delivery".
- **The list and History draw four states** (STO-2): offline, did not load (Try
  again), empty, full — and a failed refresh keeps the last list, marked "Not up
  to date".
- **Add an item** starts "Where it belongs" on nothing chosen (STO-10).
- **Per store** (106, the owner's answers of 17 September): a **Store** picker
  under the heading — All stores, then the Main, Kitchen and Bar store in the
  owner's order, then any added later. On "All stores" each card shows the
  total and a line **"Main 30 · Kitchen 8 · Bar -"**; one store shows "In
  Kitchen store" and only what is there. Every dialog asks **Which store**,
  starting on the picked store, else the Main store; a receipt is offered only
  stores switched on.
- **Move to another store** in More (`create`): From (a store holding some,
  starting as above), To (a store switched on, chosen each time), how many.
  History shows a move, and its undo, as **one line** naming both stores; its
  undo asks first and takes both halves back.
- **No long dash** in anything the page shows (D17-48, D17-60): " - " inside a
  sentence, "-" where nothing is held or nothing is set. `stores.test.tsx`
  fails on one.
- The `stores` role — **the Inventory Manager** since 16 September, key
  unchanged — lands on the Store after sign-in: it is the first entry
  of their working menu, and they have no Dashboard (`workingHomeFor`,
  `navigation.ts`; pinned in `navigation.test.ts` — `["Store", "Notifications"]`).
- No `flows/`; the page carries its own dialogs.

---

## Server endpoints — 7

The code is in `api/src/modules/stores/stores.ts` (moved 15 September); the
door `index.ts` mounts it at `/api/hotels`. There is no module switch for the
store.

```
                                              grant needed (403 otherwise)
GET    /:code/stores                          view     `stores` (Main first) and items: on hand,
                                                       value, and `byStore` — what each store holds
GET    /:code/stores/items/:id/movements      view     one item's history; each row's `store`; a move
                                                       (and its undo) as ONE row with `fromStore`,
                                                       `toStore`; `who` named for the Inventory
                                                       Manager too (STO-4); `reversesKind` (STO-6)
POST   /:code/stores/items                    create   add an item
                                              + edit   if the name is already there (it overwrites)
POST   /:code/stores/movements                create   receipt · issue · wastage · return
                                              edit     adjustment
                                                       `locationId` REQUIRED — a store at this
                                                       property; nothing received into a switched-off
                                                       one; an out-movement checks THAT store's on hand
POST   /:code/stores/transfers                create   move from one store to another (106): both
                                                       halves in one statement, via app.transfer_stock
POST   /:code/stores/movements/:id/reverse    edit     undo one movement with its own row, in its own
                                                       store — both halves of a move; refused (409) if
                                                       any store would be left below zero (STO-11)
POST   /:code/stores/import                   create   items from a file; a row that changes
                                                       an existing item needs edit, or is rejected
```

**Names in a history** come through `staff` as before, and for the Inventory
Manager through `app.colleague_name` (096) as well — the owner's answer to
STO-4. Anybody else keeps today's view (their own name; the GM and the owner
see all through `staff`).

Every endpoint has a caller in `data/stores.ts`.

**Who may is `api/src/modules/stores/stockGrants.ts`** — a COPY of
`grantsFor(role, "stock")` in `src/lib/permissions.ts` (the owner's table, the
master's file). `api/test/modules/stores/stockGrants.test.ts` fails the moment
the two differ, and tries every act as every assignable role. A change to who
may do what is the owner's; the master makes it in `permissions.ts`, and this
copy follows in the same commit. Each route asks before its first write.

---

## Data

```
data/stores.ts   getStore (stores and items), getStockHistory, addStockItem,
                 recordStockMovement (a locationId), moveStock,
                 reverseStockMovement, importStockItems. The reads throw
                 (STO-2). The import report type comes from the core
                 (@/data/repositories/importReport).
```

---

## Database

```
stock_items, stock_movements          069_stores.sql
  on hand is derived, never stored     app.stock_on_hand(item) sums the movements
  value is a weighted average          app.stock_unit_cost(item), from receipts only
  movements are append-only            trigger stock_movements_append_only (app.forbid_mutation)
  a reversal is a new row              app.reverse_stock_movement — once per movement
  quantity is signed by kind           check constraint stock_movements_sign_matches_kind
  one property cannot move another's   composite key on (hotel_id, item_id), added only if absent
  where an issue went                  to_outlet → pos_outlets; null for housekeeping and the like
  audit trigger on both tables         076_approvals.sql

stock per store, moves between stores 112_stock_held_per_store.sql
  every movement names its store       location_id, NOT NULL; checked to be a `store` at the
                                       movement's property (trigger stock_movements_place). A
                                       writer that names none gets the Main store (D17-2's rule)
  the Main store                       app.main_store(hotel): named "Main store", else the oldest
  on hand per store                    app.stock_on_hand(item, store); the total is unchanged
  a move is two halves                 kind 'transfer', one out + one in sharing transfer_id,
                                       written by app.transfer_stock in ONE statement
  neither half alone                   statement-level trigger stock_movements_transfer_whole:
                                       a move, or its undo, whole or refused. NOT deferred — a
                                       deferred check blocks ALTER TABLE in the same transaction
  undo per store, a move as a whole    app.reverse_stock_movement, replaced: in the row's store,
                                       both halves of a move in one statement
  stock recorded before                back-filled into the Main store (D17-2), with the append-
                                       only and staff-scope guards lifted for that one statement
```

Value stays per item (S4): a store's worth is the item's average cost times
what that store holds.

Deliberately absent (069's header): no price on an item — a delivery has a
price; no supplier table yet.

`suppliers` and `locations` (094, the master's Phase 0) are shared with
Equipment and Purchasing: use them, never a copy, and never change those
tables from here.

**A new migration takes the next number after cp6's highest when the file is
written** (`docs/briefs/README.md`), is referred to by what it does rather
than its number, and the master renumbers at merge if two lanes took the same
one. Never edit 046, 069 or 094.

---

## Front door

`src/modules/stores/index.ts` exports nothing yet (`export {};`). No other
service imports this one. The server's door, `api/src/modules/stores/index.ts`,
exports only `mounts`, read by `api/src/server.ts`.

---

## Leans on

No other service's door is imported by this folder (checked 15 September).

- **pos**, at the database only: `stock_movements.to_outlet` references
  `pos_outlets` — where an issue went, when it went to a till outlet (069).
  Since 24 September (D22-20) every issue says where it went: `GET
  /stores` lists the hotel's active outlets, and where there is one the
  Issue dialog will not record until the person picks an outlet or "Not an
  outlet" (sent as `outletId: null`). The server refuses an issue that
  does not say, another property's outlet, and an outlet on anything but an
  issue.

---

## Rules that bind it

- **No default prices** (`HANDOVER.md` § 5). An item has no price; the cost
  lives on the receipt, and an item nobody has received is worth a dash, not
  zero (`069_stores.sql`; `stores.ts` header). A reorder level left empty
  means nobody asked to be warned — not zero (069).
- **Nothing is edited.** On hand is summed from the movements every time; a
  wrong movement is reversed by its own row (069; `stores.ts` header).
- **A new hotel-scoped table carries the composite key from the start** — the
  database refuses a movement at one property against another's item, rather
  than accepting it and letting row security hide it (MEMORY 161). Such a
  constraint is added only if absent, never dropped and re-added (MEMORY 162).
- **Working menus**, owner's lists of 15 September (`HANDOVER.md` § 3.2):
  housekeeping — Housekeeping, Work orders, Store; stores — Store. No
  Dashboard for housekeeping or stores: it carries revenue (`navigation.ts`,
  "THE MENU EACH PERSON WORKS FROM").
- **Offline, a store write is refused.** No store path is listed in
  `src/lib/offline.ts`, and anything unlisted is refused rather than queued.
- **The role**, the Inventory Manager: "Stock and equipment. Approves
  equipment leaving the store; raises purchases." (`ROLE_DESCRIPTIONS.stores`,
  `src/lib/permissions.ts`). That approval is the equipment chat's and the
  master's; **stock going out needs no approval (S12) — do not add one.** No
  purchase can be raised today — see Open items. A store keeper once signed in as a viewer
  because two role lists disagreed; 078 made `app.assignable_roles()` the one
  list (MEMORY 184).
- **Every list draws four states**; **a new dialog declares its main action**
  (`HANDOVER.md` § 6, § 3.1).
- **Inside `withSession`, a refusal is a commit** (MEMORY 243). Checked in
  `stores.ts` on 16 September while adding STO-1's guards: every refusal in
  the six routes — the grant, a missing item, a shelf that would go below zero,
  an import's bad rows — comes before the route's first write, and
  `stockGrants.test.ts` counts that a refused role left nothing.

No Start here card and no glossary line names anything in this service.

---

## Open items

From `PENDING.md` and `PROGRESS.md`, as of 15 September:

- **Purchase and expense approvals — wanted or not?** The approvals engine
  (076) allows the kinds `purchase`, `cash_expense` and `stock_adjustment`,
  and nothing anywhere can raise one (PENDING § 4; MEMORY 222). The owner's
  decision is needed first: build the path, or delete the engine
  (PROGRESS "Still needing a person" 12).
- **The kitchen manager's menu has no Store** — approved as listed, one
  search away; worth asking the owner (PENDING § 5a).
- Found while writing this brief (15 September):
  - ~~No server test covers the store.~~ Since 16 September
    `api/test/modules/stores/stockGrants.test.ts` covers who may do what
    (STO-1). The ledger's own rules are still checked only in
    `db/tests/suite.sql`'s `store` group.
  - ~~An issue cannot say which outlet it went to from the screen.~~ It
    must, since 24 September (D22-20; the owner: "must choose each time").

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

Where the checks are today: `db/tests/suite.sql` group `store` — on hand,
weighted value, reversal, and the cross-property refusal (frozen; new checks
go in `db/tests/modules/stores.sql`, created 17 September for 106);
`src/components/app/navigation.test.ts` pins the store roles' menus.

```
api/test/modules/stores/stockGrants.test.ts   who may do what, every act × every role (STO-1)
api/test/modules/stores/historyNames.test.ts  names in a history; what an undo undid (STO-4, 6)
api/test/modules/stores/undoBelowZero.test.ts an undo may not leave less than nothing (STO-11), per store
api/test/modules/stores/stockPerStore.test.ts the stores, per-store on hand, moves (106)
db/tests/modules/stores.sql                   106 in the database: the store check, per-store on
                                              hand, a move's two halves, undoing a move
src/modules/stores/stores.test.tsx            the page: four states, More, look-only,
                                              undo asks first, a category must be chosen
src/modules/stores/data/stores.test.ts        a failed read throws, never answers empty (STO-2)
```

⚠ `stores.test.tsx` shares one query cache across the file (App.tsx's): its
first test is the only one that meets a store never loaded, and it loads the
items the rest read. A failure in that first test makes the others fail for
its reason — read the first failure first.

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.

## Requests from this service to the master

- **16 September · STO-9 · the shared dialog kit.** Measured at 375px in the
  Store's three dialogs: `DialogContent`'s Close button is **24×24px**, and
  `Input` and `NativeSelect` are **36px tall** with **15px** text (iPhones zoom
  the page when a box under 16px is tapped). All three are in
  `src/components/ui/`, so this is likely every dialog in the system. Asked
  for: 44px targets and 16px text in the kit, once, for everybody. The Store
  does not work around it locally.
