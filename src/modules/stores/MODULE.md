# Store

What the property keeps on its shelves — rice, gas, linen, soap — and where
each of it went.

**Folder name:** `stores` — the same word in all three places:

```
src/modules/stores/          the screens, their data calls, their tests
api/src/modules/stores/      the server's routes for this service
db/tests/modules/stores.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service in `HANDOVER.md` → "Folder claims"
(service, branch, date), read this file, then this folder's `MEMORY.md` and
`CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`.

"Inventory" in this system means rooms and prices — that is the `inventory`
service. The shelves are the **Store** (`docs/SERVICE-FOLDERS-PLAN.md`). The
Store's menu entry happens to sit in the menu's Inventory section.

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

- The entry needs the `inventory` grant (the default test, no `canSee`).
  Owner, admin, GM, hotel manager, finance and read-only see it in their full
  menu; other roles holding the grant — reception, the kitchen roles, the
  waiter — reach it by Find a screen.
- The `stores` role lands on the Store after sign-in: it is the first entry
  of their working menu, and they have no Dashboard (`workingHomeFor`,
  `navigation.ts`; pinned in `navigation.test.ts` — `["Store", "Notifications"]`).
- No `flows/`; the page carries its own dialogs.

---

## Server endpoints — 6

The code is in `api/src/modules/stores/stores.ts` (474 lines; moved 15
September); the door `index.ts` mounts it at `/api/hotels`. There is no module switch for the store.

```
GET    /:code/stores                          items, on hand, value
GET    /:code/stores/items/:id/movements      one item's history
POST   /:code/stores/items                    add an item
POST   /:code/stores/movements                receipt · issue · wastage · adjustment · return
POST   /:code/stores/movements/:id/reverse    undo one movement with its own row
POST   /:code/stores/import                   items from a file
```

Every endpoint has a caller in `data/stores.ts`.

---

## Data

```
data/stores.ts   173 lines. getStore, getStockHistory, addStockItem,
                 recordStockMovement, reverseStockMovement, importStockItems.
                 The import report type comes from the core
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
```

Deliberately absent (069's header): no price on an item — a delivery has a
price; no supplier table yet.

**A new migration needs a number claimed in `HANDOVER.md` first.**
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. The highest today is 089.

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
  The API accepts an `outletId`; the Store screen never sends one.

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
- **The role**: "Stock, receiving and issues. Raises purchases; approves none."
  (`ROLE_DESCRIPTIONS.stores`, `src/lib/permissions.ts`). No purchase can be
  raised today — see Open items. A store keeper once signed in as a viewer
  because two role lists disagreed; 078 made `app.assignable_roles()` the one
  list (MEMORY 184).
- **Every list draws four states**; **a new dialog declares its main action**
  (`HANDOVER.md` § 6, § 3.1).
- **Inside `withSession`, a refusal is a commit** (MEMORY 243). `stores.ts`
  has not been checked for this (PENDING § 2).

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
  - **No server test covers the store.** No file in `api/test/` touches
    `/stores`; the only checks are the `store` group in `db/tests/suite.sql`.
  - **An issue cannot say which outlet it went to from the screen.** The
    column and the API take one (`outletId`); `pages/Stores.tsx` never sends
    it. Whether it is wanted is the owner's call.

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
go in `db/tests/modules/stores.sql`, which does not exist yet);
`src/components/app/navigation.test.ts` pins the store roles' menus.

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
