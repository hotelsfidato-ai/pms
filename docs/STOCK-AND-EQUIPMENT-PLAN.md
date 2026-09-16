# Stock and equipment — the plan (16 September 2026)

**Status: APPROVED 16 September — all eleven decisions in § 5, and the permission
table in § 6. Phase 0 DONE the same day (5a5d746).** Phases 1A and 1B are next.

**Phase 0 did NOT close STO-1.** It gave stock its own grants; opened as reception
afterwards, the Store still loaded, because its route has no guard and its server
routes check no grant. Phase 1A closes it first.

The owner asked for two kinds of inventory, planned as a multi-agent job:

1. **Equipment** — everything durable in the hotel, the restaurant and the rooms,
   with its **repairs** and the **buying** of new things.
2. **Consumables** — what the kitchen and the restaurant buy and use up: cooking
   oil, gas, drinks, spares — kept in the store — **and the crockery and
   cutlery**: plates, spoons, glasses.

> "Inventory" already means rooms and prices in this system (the `inventory`
> service, the menu's Inventory section). This document says **stock** for things
> on shelves and **equipment** for durable things, so that a chat told to work
> on one never opens the other. Decision S1 settles the names on screen.

---

## 1 · What already exists — measured, not remembered

| | Where | What it does today |
|---|---|---|
| **Stock items** | `stores` service · migration 069 `stock_items` | name, the unit it is counted in, a category, a reorder level. **No price on the item** — a delivery has the price |
| **Stock movements** | 069 `stock_movements`, append-only | `receipt` (with unit cost and a supplier as free text) · `issue` (to a POS outlet) · `wastage` · `adjustment` · `return`. A wrong row is reversed, never edited. Value on hand is derived |
| **Purchase approvals** | migration 076, `api/src/routes/approvals.ts` (core) | an approval request of kind `purchase`, `cash_expense` or `stock_adjustment` |
| **Repairs** | migration 058 `work_orders` (housekeeping) | a title, a status, and an **optional room** — nothing else it can point at |
| **"Equipment"** | `src/modules/equipment/` — Coming soon | means **interfaces to room devices** (door locks, phone system, minibar, TV) — NOT a register of equipment |
| **Store audit** | `src/modules/stores/DEFECTS.md`, STO-1 to STO-10 (16 Sep) | **STO-1: anybody rostered at the hotel can change the store, the Viewer included.** STO-2: an unreadable store says it is empty. STO-6: undo is one tap with no confirmation |

**So consumables are two-thirds built, crockery is a third, equipment is not
started, repairs and purchasing are half-pieces waiting to be joined.**

---

## 2 · The shape

```
                    ┌───────────── PURCHASING ─────────────┐
                    │ request → approval (076) → order →   │
                    │ delivery                             │
                    └───────┬───────────────────────┬──────┘
                            │ a delivery of stock   │ a delivery of equipment
                            ▼                       ▼
   ┌──────────── STOCK (stores) ────────────┐   ┌──────── EQUIPMENT ────────┐
   │ consumables: oil, gas, drinks, spares  │   │ the register: what, where,│
   │ crockery & cutlery: breakage, par, count│  │ tag, cost, warranty, AMC, │
   │ kept in: main store · kitchen · bar    │   │ status                    │
   └───────────┬────────────────────────────┘   └────────────┬──────────────┘
               │ issued to an outlet / a department           │ breaks
               ▼                                              ▼
          REPORTS: value on hand,                    REPAIRS (work orders,
          use per outlet, wastage,                   housekeeping): a repair
          breakage, equipment cost                   against THIS item
```

**Two things are shared by all of it** and are built once, first, by the master
chat — or every lane invents its own:

- **Suppliers** — a record, not the free text a receipt holds today.
- **Locations** — main store, kitchen store, bar store, the restaurant, each room,
  public areas. Stock sits in one; equipment stands in one; a repair happens in one.

---

## 3 · The work, split so chats never share a file

| Phase | Lane (service folder) | Work | Runs alongside | Size |
|---|---|---|---|---|
| **0** | **master** | Suppliers and locations (one migration); permission resources for stock, equipment and purchasing in `permissions.ts`; the menu names (S1); migration numbers follow § 7 | — | 2 days |
| **1A** | **stores** | Fix STO-1 to STO-10 first. Then: stock held per location with transfers (main store → kitchen); par levels per location; a stock-count sheet (count, compare, one adjustment per difference); gas by cylinder (S5) | 1B | 4 days |
| **1B** | **equipment** (S2) | The register: item, category, location, tag number, cost, purchase date, supplier, warranty and AMC dates, status (in use · under repair · retired); import from a file | 1A | 3 days |
| **2A** | **stores** | Crockery and cutlery (S6): a `breakage` movement with who and where; in use at an outlet vs in the store; par per outlet; the monthly count | 2B, 2C | 2 days |
| **2B** | **housekeeping** | A work order can point at an equipment item; repair cost; the item's repair history; an item under repair shows it | 2A, 2C | 2 days |
| **2C** | **purchasing** (new, S8) | Purchase request → approval (076) → purchase order to a supplier → delivery: stock arrives as a receipt in `stores`, equipment arrives as a register entry | 2A, 2B | 4 days |
| **3A** | **reports** | Stock value on hand; use per outlet; wastage and breakage; equipment register and repair cost | — | 3 days |
| **3B** | **finance** | Supplier bills and payments — only after S10 | — | later |
| **3C** | **pos** | A dish sold uses its ingredients (recipes) — only if S9 says so | — | later |

**Parallel at most three at a time**, as every brief says: 1A + 1B, then
2A + 2B + 2C, then 3A.

**Order matters in two places.** Phase 0 before anything, because suppliers and
locations are used by every lane. And 2C after 1A and 1B, because a delivery
lands in both.

---

## 4 · Rules every lane in this plan follows

- **No invented quantities or prices.** Opening stock is counted and typed in or
  imported; the equipment register is entered or imported. An uncounted item is a
  dash, never a zero — the same rule as prices.
- **Stock is a ledger.** Nothing is edited; a mistake is reversed, and both rows
  stay (069 already works this way — keep it).
- **Crockery that breaks is a movement with a reason and a person**, not a quiet
  correction at the month's count.
- **An approval is the owner's rule, with the owner's numbers.** No purchase
  limit ships with a default amount.

---

## 5 · Decisions the owner makes before anything starts

| # | Decision | Recommendation |
|---|---|---|
| **S1** | Names on screen | **"Store"** for stock, **"Equipment"** for durable things, and the current menu section "Inventory" renamed **"Rooms and rates"** — so nobody reads "inventory" and opens the wrong thing |
| **S2** | The `equipment` service means device interfaces today. Use it for the equipment register? | **Yes.** Door locks and the phone system move to a Coming-soon entry of their own, "Room systems" |
| **S3** | Where stock is kept at each property | **Main store, kitchen store, bar store** to start; more can be added |
| **S4** | How stock is valued | **Weighted average cost** — the standard for kitchens, and simpler to check than first-in-first-out |
| **S5** | Gas | **Counted in cylinders**, full and empty |
| **S6** | Crockery and cutlery | **Stock items with breakage and a monthly count**, not equipment |
| **S7** | Equipment: every item one by one, or by count? | **Costly items one by one with a tag** (AC, TV, fridge, oven); **cheap items by count per room** (kettles, hangers) |
| **S8** | Purchasing as its own service, or inside the Store? | **Its own service** — it serves both stock and equipment, and its own folder lets a chat build it alongside the other two |
| **S9** | A dish sold uses its ingredients (recipes) | **Later.** It is a large piece, and stock has to be right first |
| **S10** | Supplier bills and payments: in this system or in Tally? | **Tally, later** — decided with the accounting service |
| **S11** | Who approves a purchase, and above what amount | **The GM approves; the owner above a limit the owner sets.** No amount is invented |

---

## 6 · Who may do what — approved 16 September, as built in Phase 0

| Role | Store (stock) | Equipment | Purchasing |
|---|---|---|---|
| Owner · Admin · General Manager | everything | everything | request and approve (GM up to the owner's limit) |
| Hotel Manager | see, receive, issue, count | see, add, edit | request |
| Store Manager | see, receive, issue, count, breakage | see | request |
| Kitchen Manager | see, issue to the kitchen, breakage | see, report a repair | request |
| Chef · Housekeeping | see | see, report a repair | — |
| Reception | — | see, report a repair | — |
| Accountant | see, export | see, export | see, export |
| Viewer | see | see | see |
| Revenue Manager · Till Operator | — | — | — |

In `src/lib/permissions.ts`, pinned by `src/lib/permissions.test.ts`. "Report a
repair" is a work order, wired by housekeeping in phase 2B.

## 7 · Migration numbers in this plan

**A chat takes the next number after cp6's highest when it starts** (095 after
Phase 0). If two chats take the same one, the master renumbers the later one when
it merges. Do not write the number into a test name or a comment — refer to the
file by what it does, so a renumbering touches one filename. Numbers cannot be
handed out in advance: the guard refuses a gap, so a reserved number nobody uses
blocks every merge after it.
