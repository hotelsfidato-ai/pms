# Equipment — your brief (phase 1B)

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

**Then read `docs/STOCK-AND-EQUIPMENT-PLAN.md`** — the owner approved it on
16 September, all eleven decisions and the table of who may do what. You are
**phase 1B**. A Store chat runs **1A** at the same time, in its own folder.

---

## What you are building

**The register of everything durable in the hotel, the restaurant and the
rooms** — an AC, a TV, a fridge, an oven, a kettle, a table. Not stock (the
Store's: things used up), not door locks or room phones (`room-systems`, not
built). The owner gave the `equipment` folder this meaning (S2).

Until 16 September this folder described door locks and phones. Its
`MODULE.md` still carries those notes as history — **rewrite `MODULE.md` for
the register** as part of your work.

---

## What you own

```
src/modules/equipment/              the register screen, its data, its tests
api/src/modules/equipment/          your routes — index.ts EXISTS, empty, already
                                    mounted in server.ts by the master
api/test/modules/equipment/         your server tests (create it)
db/tests/modules/equipment.sql      your database checks (create it)
db/migrations/                      ONLY your new file — see "Migrations"
```

---

## What already exists for you — Phase 0, built by the master

- **The permission `equipment`**, in `src/lib/permissions.ts`, pinned by its
  test, in plain words in plan § 6: owner, admin and GM everything; Hotel
  Manager see, add, edit; Store Manager, Kitchen Manager, Chef, Housekeeping and
  Reception see; Accountant see and export; Viewer see; Revenue Manager and Till
  Operator nothing. **You read it. You never change it.**
- **`locations`** (migration 094) — named places at a property: store, kitchen,
  bar, restaurant, public area, office, other. **`suppliers`** (094) — who an item
  came from. **Use both. Never make your own.** The Store chat uses them too.
- **`rooms`** already exists. An item stands in **a room or a location** —
  exactly one of the two.
- **The menu section "Store and equipment"** exists; the Store is in it.

---

## The register — what "done" means

From plan § 3, phase 1B, and decision S7:

1. **An item:** name, category, where it is (a room or a location), supplier,
   purchase date, cost, warranty end date, service-contract (AMC) end date,
   status **in use · under repair · retired**.
2. **Two ways to hold a thing (S7):**
   - **one by one, with a tag** — costly things (AC, TV, fridge, oven); the tag
     is unique at the property;
   - **by count per place** — cheap things (kettles, hangers): "12 kettles in
     room 104" is one line with a quantity.
3. **Never deleted.** A thing leaves by being **retired**, with who and when.
   `revoke delete on <table> from pms_app;` — migration 010's default privileges
   grant DELETE on anything new.
4. **Moving it** to another room or place is recorded, not overwritten: where
   it was, where it went, who, when.
5. **Import from a file** — the opening register is typed in or imported. Use
   the shared import (`src/lib/importSpec.ts`, the Store's Import as the
   example); **do not edit** the shared files.
6. **The screen** at `/h/:code/equipment`: the list, filtered by place and
   status, and an item's page. At 375px too — housekeeping and reception read
   it on a phone.
7. **The server refuses** every write to a role without the grant: adding and
   importing need `create`, a change or a move or retiring needs `edit`, an
   export needs `export`, reading needs `view`. Copy the pattern of
   `api/src/modules/inventory/rateSetters.ts` — a copy of the role lists, and a
   test that fails the moment it differs from `grantsFor(role, "equipment")`.
   **The test tries every role a person can be given**; a file that only proves
   the GM can write passes with no guard.

**NO INVENTED VALUES.** No item, category list, cost or date is seeded. A cost
nobody typed is **a dash, never a zero**. A warranty nobody entered shows a
dash, never "expired".

---

## Ask the owner before you build these — each with your recommendation

- **The categories** (furniture, appliance, kitchen equipment, electronics…):
  a fixed list, or one a manager adds to?
- **What makes a thing "costly"** enough for a tag. **Do not propose an
  amount** — the owner sets any figure. The simplest answer is that the person
  entering the item chooses.
- **The tag's form** — printed labels they already use, or numbers the system
  gives?
- **Who needs it in their working menu** (reception, housekeeping, store,
  kitchen)? Everybody with `view` can find it through Find a screen either way.
- Does **retiring** a costly item need the GM's approval (`approve` exists on
  the permission)?

---

## Not yours

- **Repairs.** A work order pointing at an item, its cost and the item's repair
  history are **phase 2B, the housekeeping chat** (migration 058's
  `work_orders`). Your status "under repair" is set by hand until then. **Do not
  touch `work_orders`.**
- **Buying new equipment** — phase 2C, `purchasing`.
- **Door locks, room phones, minibar, TV connections** — `room-systems`.

---

## The menu — one exception to the master's files

When your screen works, your `nav.ts` **replaces** its Coming soon entry with the
real one: section `"store-and-equipment"`, label `"Equipment"`, `to:
"/h/:code/equipment"`, `resource: "equipment"`, order 20 (the Store is 10), no
`workingMenus` until the owner has answered who gets it. Delete the Coming soon
route and `pages/Equipment.tsx`.

`navigation.test.ts` pins the Coming soon list, and two places may not share a
name, so that switch fails one line of the test. **You may make exactly that one
edit to `src/components/app/navigation.test.ts`: remove `"Equipment"` from the
`SOON` list. Nothing else in that file**, and say so when you hand back. The
owner's answer about working menus goes in your hand-back note; the master
changes the pinned menus.

---

## Migrations

**The number is the next after the highest on cp6 when you write the file** —
095 while nothing else has merged. The Store chat may take the same number;
**that is expected** — the master renumbers whichever merges second. So refer to
your migration by what it does, never by its number, in test names and
comments. Never edit 094; a change to `locations` or `suppliers` is a request to
the master.

---

## Yours to touch, and nothing else

**Yes:** your folders above, your migration file, the one test line above.

**No — these break other chats:**

- `src/modules/stores/`, `api/src/modules/stores/` — **the Store chat, running
  now.**
- `src/modules/housekeeping/` — repairs are theirs, in 2B.
- `src/modules/purchasing/`, `src/modules/room-systems/` — not built.
- `src/lib/permissions.ts` and its test — the owner's table.
- `api/src/server.ts`, `api/src/mount.ts` — already done for you.
- `src/components/ui/`, `src/lib/`, `src/App.tsx` — shared. Your routes are
  already mounted through `routes.tsx`.

---

## Start here

1. **Make your copy** (the owner's PC, PowerShell, in `D:\fidato pms`):
   `git worktree add "..\fidato-equipment" -b equipment/phase-1b`, then the two
   junctions and the root `.env` as the README says. **Never the `api/.env`.**
2. **Your database and ports:** `DB=fidato_equipment ./db/migrate.sh --with-dev-identities`
   (Git Bash, in your copy); API `PORT=8797`.
3. **Claim it:** `npm run claim -- equipment "Phase 1B: the equipment register"`.
4. Read the plan, `MODULE.md`, `DEFECTS.md` (`EQ-` numbers).
5. **Bring the owner the five questions above**, with recommendations. Build
   what does not depend on the answers meanwhile.
6. Before every commit: `npm run lane -- equipment` and every gate in the README.
7. When you stop: rewrite `MODULE.md`, your `CHANGELOG.md`, release the claim,
   and tell the master the branch name — the master merges.
