# Equipment

**The register of everything durable in the hotel, the restaurant and the
rooms** — an AC, a TV, a fridge, an oven, a kettle, a table. Built 16 September
2026 as **phase 1B** of `docs/STOCK-AND-EQUIPMENT-PLAN.md` (decisions S2, S7,
S12–S16). Brief: `docs/briefs/equipment.md`.

Not stock — things used up are the Store's (`stores`). Not door locks, room
phones, minibar or TV connections — those are `room-systems`, not built. Until
16 September this folder meant those; that meaning moved there unchanged.

**The person who runs it is the Inventory Manager** — the `stores` role,
renamed on 16 September (S13); the key did not change.

```
src/modules/equipment/              the register screen, the item page, their data and tests
api/src/modules/equipment/          the routes (equipment.ts) and who may use them (grants.ts)
api/test/modules/equipment/         grants.test.ts — every role at every door
                                    register.test.ts — what the register does
db/migrations/<n>_equipment_register.sql   tables, moves, the derived answers, the guards
db/tests/modules/equipment.sql      the database's own rules
```

**Refer to the migration by what it does ("the equipment register"), never by
its number.** Written as 095; renamed **097** when this branch merged cp6 (the
master took 095 and 096 for the approvals). The master renumbers whichever lane
merges second (plan § 7).

---

## The owner's answers — 16 September, do not re-ask

Every one was asked with a recommendation; every recommendation was taken.

| Question | Answer |
|---|---|
| Categories: fixed, or one the hotel adds to? | **The hotel adds to it.** Each property starts with none; whoever adds an item picks one already used there or types a new one. The same word in different capitals is one category. |
| What makes a thing "costly" enough for a tag? | **The person adding chooses** — one by one with a tag, or a count in one place. No amount of money decides it. |
| The tag's form | **The system offers, the person may type.** The next free EQ-number is offered; a printed label may be typed instead. No tag repeats at a property. |
| A counted line's cost, and part of a count | **Per piece; part may move** or be retired, recorded with how many, who and when. |
| Retiring a tagged item | **A Hotel Manager's waits** — and since S16, in the **one shared approvals inbox**, for the **Inventory Manager**, with the owner, an administrator or the GM as backup. Counted lines, and anything an approver retires, go straight through. |
| Leaving the store (S12–S15) | Equipment going **out of a store** waits for the Inventory Manager (the owner, admin or GM instead). **Anybody who can see equipment may ask.** Stock is not this service's. |
| Who may record a move that needs no approval (between rooms, into a store)? | **Anybody who may edit** — owner, admin, GM, Hotel Manager, Inventory Manager. |
| Part of a count leaving the store | **Split off when asked.** If refused, those pieces stay in the store as their own line, with the reason beside them. |
| Store to store (main store → kitchen store) | **Needs nobody** — it goes into a store. |
| Names in an item's history | **Whoever may approve sees them** (Inventory Manager, GM, admin, owner). Everybody else sees a dash — except their own name. |
| Working menus | **The Inventory Manager's** (S13, built). **Housekeeping's** too (answered) — the master changes that pinned menu. |
| Places and suppliers can be added nowhere yet | **The master builds one shared door**, for the Store and Equipment alike. Until it lands no store exists to leave, so the approval cannot be seen working at a real property. |

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Equipment | `/h/:code/equipment` | `pages/EquipmentRegister.tsx` | anyone holding a grant on `equipment`; in the Inventory Manager's working menu |
| (an item) | `/h/:code/equipment/:id` | `pages/EquipmentItem.tsx` | the same; reached from the list |

Both addresses are **guarded** (`RequireAccess`), so the revenue manager and the
till operator are refused the page, not only the menu entry.

**The register** — filtered by place and status; cards on a phone. Add, import,
export. **What waits in the inbox** is listed at the top, beside the thing it is
about, with Approve and Refuse **only where the core's queue says `mayDecide`**
(`flows/Decide.tsx`), and its `blockedBecause` as the sentence otherwise. Pills:
waiting to leave the store, taking it out refused, retirement waiting.

**An item** — details; what waits for it (with the same decide buttons); a
refusal and its reason beside it; retired with who, when, why and who asked.
Change details · Move (or **Ask to take out**, for somebody who may only look and
the thing is in a store) · Under repair / Back in use · Retire. The history, newest
first, merges what happened (added, split, status, retired, edited), the moves,
and the requests with their decisions.

**Rule 6.** A button the person may not use is shown disabled, with who may —
built from `src/lib/permissions.ts` (`words.ts`, `whoMay`).

---

## How it works

### Where a thing is, and whether it is retired — WORKED OUT, never copied

The approvals inbox is the core's (076, 095, 096) and **records a decision and
performs nothing**. So this service never applies a decision into its own tables:

```
where a thing is      app.equipment_place(item)      its latest move that needed no
                                                     approval, or whose approval is approved
retired               app.equipment_is_retired(item)  status 'retired', or an equipment_retire
                                                     approval for it is approved
waiting               app.equipment_move_waiting / app.equipment_retire_waiting
leaving a store       app.equipment_leaves_store(from, to)   from a `store` place, to anything else
```

A refused request therefore leaves the thing where it was, and nothing has to be
undone.

### Tables

```
equipment_categories   per property; one name in any capitals; select, insert only
equipment_items        the register; no place column; RLS forced; the shared audit trigger
equipment_moves        every place a thing has stood and every move asked for;
                       `placed` (first) or `move`; `approval_id` when it leaves a store;
                       append-only; the application may insert and read
equipment_history      added, split, status, retired, edited; written by triggers only
```

### What the database refuses, whichever route sends it

- **Leaving a store with no request** while the property has the rule
  (`app.equipment_issue_rule_applies`, the same test `app.request_approval` applies).
- A move carrying **somebody else's approval**, or an approval where none is needed.
- **Anything while a request waits** — another move, a status, a split, a direct
  retirement.
- **Any change to a retired thing** — retired directly or in the inbox.
- A count typed over (only a split changes it); a thing with no place at commit;
  a place or supplier from another property; tagged ↔ counted; a retirement
  without who, when and why.
- **Delete**, on all four tables (revoked, not left out — 010's default privileges).

### Who may (grants.ts — a copy of `permissions.ts`, pinned by its test)

```
view     read; ASK for a thing to leave the store (S15)
create   add; import
edit     change; move between rooms or into a store; status; retire
approve  retire a tagged item without waiting; see names in the history
export   the register, out
```

Owner, admin, GM: all. Hotel Manager: view, create, edit. **Inventory Manager:
view, create, edit, approve.** Kitchen Manager, Chef, Housekeeping, Reception,
Viewer: view. Accountant: view, export. Revenue Manager, Till Operator: nothing.
Refusals name the Inventory Manager by that name.

---

## Endpoints

All under `/api/hotels`, all asking `grants.ts` first.

| Route | Needs |
|---|---|
| `GET /:code/equipment` — the list, with what waits and what was refused | view |
| `GET /:code/equipment/options` — rooms, places (with kind), suppliers, categories, next tag | view |
| `GET /:code/equipment/items/:id` — one item and its merged history | view |
| `POST /:code/equipment` — add, with where it is | create |
| `POST /:code/equipment/import` — dry run, then apply | create |
| `PATCH /:code/equipment/items/:id` — details | edit |
| `POST /:code/equipment/items/:id/move` — out of a store: **view**, reason required, raises `equipment_issue`; otherwise **edit**. `count` for part of a line | view / edit |
| `POST /:code/equipment/items/:id/status` — in use / under repair | edit |
| `POST /:code/equipment/items/:id/retire` — a tagged item from somebody who may not approve raises `equipment_retire` | edit |
| `GET /:code/equipment/export` | export |

**Deciding is the core's:** `GET /:code/approvals` and
`POST /:code/approvals/:id/approved|rejected` (`api/src/routes/approvals.ts`).
This service has no approve or decline route of its own — it had one before S16,
and it was removed.

**Import.** Columns in `importColumns.ts` (no imports, so the API test can read it)
and `importSpec.ts`. Putting a thing somewhere by import is adding it — no approval.

---

## What it leans on

- **The approvals core** — `app.request_approval`, the queue and decision
  endpoints, kinds `equipment_issue` (095) and `equipment_retire` (096),
  `app.colleague_name` (096). Never edited here.
- **`rooms`** (003), **`locations`, `suppliers`** (094, read only), the shared
  audit trail, the shared import dialog.

## Not this service's

- **Repairs** — phase 2B, housekeeping (`work_orders`). "Under repair" is by hand.
- **Buying equipment** — phase 2C, `purchasing`.
- **Door locks, room phones, minibar, TV connections** — `room-systems`.

---

## Gates

```powershell
npx tsc -b --force                       # web types
cd api; npx tsc --noEmit                 # API types — includes the API tests (EQ-4)
npx vitest run                           # web
cd api; npm test                         # API; `npm test -- modules/equipment` for this service
bash db/tests/run.sh                     # database
npm run build                            # "no test sign-in in dist"
```

**One migration run at a time on the local Postgres** (EQ-3).

---

## Requests

- **16 Sep · equipment → master · Housekeeping's working menu.** The owner chose
  it; the pinned housekeeping list in `navigation.test.ts` is the master's.
- **16 Sep · equipment → master · one door for places and suppliers.** Until it
  lands nothing can add a store, so leaving the store cannot happen at a real
  property.
- **16 Sep · equipment → master · deleting an untraded property** (EQ-2):
  `app.forbid_hotel_delete()` does not count equipment.

Requests from other services: none yet. Add a line — date, your service, what you
need and why — and raise it with the owner.
