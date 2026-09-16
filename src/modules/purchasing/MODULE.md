# Purchasing

Asking for something, getting it approved, ordering it from a supplier, and
receiving it — as stock in the Store, or as an item in the Equipment register.

**NOT BUILT. A Coming soon page only.** Chosen by the owner as its own service
on 16 September (decision S8), because it serves both the Store and Equipment.
Built in **phase 2C** of **`docs/STOCK-AND-EQUIPMENT-PLAN.md`** — read that
first; every decision behind this service is in its § 5.

**Folder name:** `purchasing` — the word the other two places will use:

```
src/modules/purchasing/          the Coming soon page, today
api/src/modules/purchasing/      does not exist yet
db/tests/modules/purchasing.sql  does not exist yet
```

---

## What it will be

request → approval → purchase order → delivery

- **Who requests:** the store manager, the kitchen manager, the hotel manager
  (`purchasing: create`).
- **Who approves:** the general manager, and the owner above a limit **the
  owner sets** (S11). No amount ships.
- **What a delivery does:** stock arrives as a `receipt` in the Store's ledger
  (`stock_movements`, 069); equipment arrives as an entry in the Equipment
  register.

## What it leans on — already built

- **Approvals** (migration 076, `api/src/routes/approvals.ts`, core): a request
  of kind `purchase` already exists.
- **Suppliers** (migration 094, shared): who a thing is bought from.
- **Locations** (094): where a delivery goes.
- **The Store** (`stores`) and **Equipment** (`equipment`), built before this.

## Not before

Phase 2C starts after the Store (1A) and Equipment (1B) are merged. A delivery
needs somewhere to land.
