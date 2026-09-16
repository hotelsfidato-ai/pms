# Equipment

**The register of everything durable in the hotel, the restaurant and the
rooms** — an AC, a TV, a fridge, an oven, a kettle, a table. Built 16 September
2026 as **phase 1B** of `docs/STOCK-AND-EQUIPMENT-PLAN.md` (decisions S2 and
S7). Brief: `docs/briefs/equipment.md`.

Not stock — things used up are the Store's (`stores`). Not door locks, room
phones, minibar or TV connections — those are `room-systems`, not built. Until
16 September this folder meant those; that meaning moved there unchanged.

```
src/modules/equipment/              the register screen, the item page, their data and tests
api/src/modules/equipment/          the routes (equipment.ts) and who may use them (grants.ts)
api/test/modules/equipment/         grants.test.ts — every role at every door
                                    register.test.ts — what the register does
db/migrations/<n>_equipment_register.sql   the tables, the history triggers, the next tag
db/tests/modules/equipment.sql      the database's own rules, 51 checks
```

**Refer to the migration by what it does ("the equipment register"), never by
its number.** It was written as 095; the Store's phase 1A may take the same
number, and the master renumbers whichever merges second (plan § 7).

---

## The owner's answers — 16 September, do not re-ask

Asked with recommendations before anything was built; every recommendation was
taken.

| Question | Answer |
|---|---|
| Categories: fixed, or one the hotel adds to? | **The hotel adds to it.** Each property starts with none. Whoever adds an item picks one already used there or types a new one in the same form. Nothing is seeded; the same word in different capitals is one category. |
| What makes a thing "costly" enough for a tag? | **The person adding chooses** — one by one with a tag, or a count in one place. No amount of money decides it. |
| The tag's form | **The system offers, the person may type.** The form suggests the next free number (EQ-0001, EQ-0002…); a printed label already on the item may be typed instead. No tag repeats at a property. |
| Does retiring need the GM's approval? | **A tagged item retired by a Hotel Manager waits** for the GM, owner or admin. Counted lines, and anything the GM retires, go straight through. Who, when and why are recorded either way. |
| Whose working menu? | **Housekeeping.** Not yet wired: the pinned menus are the master's (see Requests). Everybody with `view` finds it through Find a screen meanwhile. |
| Places and suppliers can be added nowhere yet | **The master builds one shared door** for places and suppliers, used by the Store and Equipment alike. Until it lands, an item stands in a room and its supplier is a dash. |
| A counted line's cost, and part of a count | **Per piece; part may move.** Moving 2 of 12 kettles, or retiring 1, is recorded with how many, who and when. |

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Equipment | `/h/:code/equipment` | `pages/EquipmentRegister.tsx` | anyone holding a grant on `equipment` — Store and equipment section, after the Store |
| (an item) | `/h/:code/equipment/:id` | `pages/EquipmentItem.tsx` | the same; reached from the list |

Both addresses are **guarded** (`RequireAccess`, asking the navigation), so the
revenue manager and the till operator are refused the page, not only the menu
entry. `src/modules/equipment/equipment.test.tsx` renders the refusal.

**The register** — the list, filtered by place and by status; a card per line
on a phone (`DataTable`). Add an item, import a file, export the register.
Approvers see the retirements waiting for them at the top.

**An item** — its details, and everything that has happened to it, newest
first, each with who and when. Change details · Move · Under repair / Back in
use · Retire; approve or decline a waiting retirement.

**Rule 6.** A button the person may not use is shown disabled, and the page
says who may — built from `src/lib/permissions.ts` (`words.ts`, `whoMay`).

---

## What the register holds

- **An item:** name, category, tagged or counted, tag or count, a room or a
  place (exactly one), supplier, purchase date, cost, warranty end, service
  contract (AMC) end, status **in use · under repair · retired**.
- **Tagged** — one thing, quantity 1, a tag unique at the property in any
  capitals. **Counted** — a quantity, no tag. The cost is per piece; the line's
  total is worked out.
- **Never deleted.** `revoke delete` on all three tables. A thing leaves by
  being retired, with who, when and why; a retired item never changes again.
- **Part of a count** is split off as its own line (`split_from`) before it
  moves, changes status or is retired. The lines always add up; the database
  refuses a count typed over.
- **Nothing invented.** No category, item, cost or date ships. A cost nobody
  typed is null — a dash on screen, never ₹0. A warranty nobody entered is a
  dash, never "expired".

### Tables

```
equipment_categories   per property; unique by lower(name); select, insert only
equipment_items        the register; RLS forced; the shared audit trigger (write_audit)
equipment_history      append-only; the application may only READ it
```

**The history is written by triggers on `equipment_items`**
(`app.equipment_items_record`, SECURITY DEFINER) for every add, split, move,
status change, retirement request, decline, retirement and edit — so no route
can change a place, a status or a count and forget to record it. A route says
**why** through the transaction-local setting `app.equipment_note`; **who** is
`app.current_user_id()`.

`app.equipment_items_guard` (trigger `equipment_items_1_guard`, named to fire
first) refuses: a place or supplier from another property (094's tables have no
composite key to point at), adding an item already retired, any change to a
retired item, moving between properties, changing tagged/counted, and a count
typed over.

`app.next_equipment_tag(hotel)` — the next EQ-number offered. Pads only what is
shorter than four digits (root MEMORY 280): after EQ-9999 comes EQ-10000.

---

## Endpoints

All under `/api/hotels`, all asking `grants.ts` first.

| Route | Needs |
|---|---|
| `GET /:code/equipment` — the list | view |
| `GET /:code/equipment/options` — rooms, places, suppliers, categories, next tag | view |
| `GET /:code/equipment/items/:id` — one item and its history | view |
| `POST /:code/equipment` — add | create |
| `POST /:code/equipment/import` — dry run, then apply | create |
| `PATCH /:code/equipment/items/:id` — details | edit |
| `POST /:code/equipment/items/:id/move` — `count` for part of a line | edit |
| `POST /:code/equipment/items/:id/status` — in use / under repair | edit |
| `POST /:code/equipment/items/:id/retire` — waits when tagged and the caller may not approve | edit |
| `POST /:code/equipment/items/:id/retire/approve` and `/decline` | approve |
| `GET /:code/equipment/export` | export |

**`grants.ts` is a copy of the `equipment` row of the owner's table** in
`src/lib/permissions.ts`. `api/test/modules/equipment/grants.test.ts` fails the
moment the two differ, and tries all thirteen assignable roles at every door —
a refusal must leave no item, category, split or history behind. Seen to fail:
58 tests with the role check taken out; 1 test (naming the action) with a role
added to the copy.

**Import.** Columns in `importSpec.ts` (`EQUIPMENT_SPEC`): Item, Category, Held
as (tag/count), Tag, How many, Room, Place, Supplier, Bought on, Cost, Warranty
ends, Service contract ends, Status. Dates day first (14/03/2025) or as the
calendar writes them; a month-first date is refused, not guessed. A blank tag
on a tag row is given the next free number, shown in the dry run. A row naming
a room, place or supplier the property does not have is rejected with its line
number. `register.test.ts` sends every column of the website's template and
checks each one landed.

---

## What it leans on

- **`rooms`** (003) — composite key `(hotel_id, room_id)`.
- **`locations`, `suppliers`** (094, the master's) — read, never written.
- **The shared audit trail** (`app.write_audit`, 011/016/076).
- **The shared import dialog** (`src/components/flows/ImportDialog.tsx`) and
  `src/lib/importSpec.ts` / `csv.ts` — used, not changed.

---

## Not this service's

- **Repairs** — a work order pointing at an item, its cost, the item's repair
  history: **phase 2B, housekeeping** (`work_orders`, 058). "Under repair" is set
  by hand until then.
- **Buying equipment** — phase 2C, `purchasing`.
- **Door locks, room phones, minibar, TV connections** — `room-systems`.

---

## Rules that bind it

- **No decision without the owner's approval** (`HANDOVER.md` § 5).
- **A missing figure is a dash, never a zero**; a warranty nobody entered is
  never "expired".
- **Never deleted** — retire, with who, when and why.
- **Reach other services only through their `index.ts`**
  (`src/test/boundaries.test.ts`).

---

## Gates

```powershell
npx tsc -b --force                # types
npx vitest run                    # web — equipment.test.tsx, navigation.test.ts
cd api; npm test -- modules/equipment   # the API tests for this service; `npm test` for all
bash db/tests/run.sh              # the database suite, equipment.sql included
npm run build                     # "no test sign-in in dist"
```

**Never run two migrations against the local Postgres at once** — the API
suite's scratch database and `db/migrate.sh` both alter cluster-wide roles, and
the second fails with "tuple concurrently updated" (DEFECTS EQ-3).

---

## Requests

- **16 Sep · equipment → master · the working menu.** The owner chose
  Housekeeping's working menu. Add `workingMenus: ["housekeeping"]` to this
  service's entry and the pinned housekeeping list in `navigation.test.ts`.
- **16 Sep · equipment → master · one door for places and suppliers.** The
  owner's answer: the master builds one screen and route to add places and
  suppliers (094), used by the Store and Equipment. Until then nothing can add
  either, and this register reads them only.
- **16 Sep · equipment → master · deleting an untraded property.**
  `app.forbid_hotel_delete()` (066) does not count equipment. A property with a
  register but no bookings would pass that check, and the cascade would then
  stop at `equipment_history`'s append-only trigger with a message about a
  history row. Add "equipment items" to its evidence list (DEFECTS EQ-2).

Requests from other services: none yet. Add a line — date, your service, what
you need and why — and raise it with the owner.
