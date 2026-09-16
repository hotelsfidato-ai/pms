# Changelog — Equipment

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md` — the master's.

---

## 2026-09-16 · Phase 1B — the equipment register

**Asked for:** the owner — "You are the equipment agent for Fidato PMS. Read
docs/briefs/equipment.md and follow it exactly." The brief: phase 1B of
`docs/STOCK-AND-EQUIPMENT-PLAN.md`, the register of everything durable in the
hotel, the restaurant and the rooms, with five questions for the owner first.

**Asked the owner first, and every recommendation was taken** (the table is in
`MODULE.md`): categories a hotel adds to, nothing seeded · the person adding
chooses tag or count · the form offers the next EQ-number, a printed label may
be typed · a tagged item retired by a Hotel Manager waits for the GM ·
Housekeeping's working menu · **two questions the brief did not have**: nothing
in the system can add a place or a supplier (the master builds one shared door),
and a counted line's cost is per piece with part of a count able to move.

**Shipped** — on branch `equipment/phase-1b`, copy `D:\fidato-equipment`
- **Migration "the equipment register"** (written as 095) —
  `equipment_categories`, `equipment_items`, `equipment_history`. Never deleted
  (revoked, not left out). A room or a place, exactly one. Tag unique per
  property in any capitals. History written by **triggers**, so no route can
  forget a move; the application may only read it. A count changes only by
  splitting part off. A retired item never changes. `app.next_equipment_tag`
  pads without truncating. The shared audit trigger on items.
- **Server** — `api/src/modules/equipment/equipment.ts` (list, options, item,
  add, edit, move, status, retire, approve, decline, import, export) and
  `grants.ts`, a copy of the owner's table pinned to `permissions.ts`. Every
  refusal sits above the first write (root MEMORY 243).
- **Screens** — `/h/:code/equipment` (the list, filtered by place and status;
  cards on a phone; add, import, export; approvals waiting) and
  `/h/:code/equipment/:id` (details, history in words, change · move · repair ·
  retire · approve/decline). Both guarded. Blocked buttons shown disabled with
  who may. `words.ts` holds the dash rules in one place.
- **Import** — `importSpec.ts` (`EQUIPMENT_SPEC`) with the shared dialog;
  examples carry no cost and no date.
- **Menu** — `nav.ts` now the real entry (Store and equipment, order 20,
  `resource: "equipment"`, no `workingMenus`). `pages/Equipment.tsx` and the
  Coming soon address deleted.
- **The one permitted master-file edit:** `"Equipment"` removed from the `SOON`
  list in `src/components/app/navigation.test.ts`. Nothing else in that file.
- `MODULE.md` rewritten for the register; `DEFECTS.md` EQ-1 to EQ-3.

**Found**
- **EQ-1, mine, fixed before commit** — `on conflict do update` needs UPDATE,
  which the application does not hold on categories; every new category 500'd.
  Found by this service's API tests.
- **EQ-2, open, the master's** — `forbid_hotel_delete` (066) does not count
  equipment; deleting an untraded property with a register is refused by the
  history's append-only trigger, with a message nobody can act on.
- **EQ-3, open, everybody's** — two migration runs at once on the local
  Postgres fail with "tuple concurrently updated" (`alter role` is
  cluster-wide). I caused it by migrating my database during an API run.
- **In passing, not mine:** stray typed text inside comments on cp6 —
  `src/components/app/navigation.ts` lines 89–95 (since 9870ac16, 5 September)
  and `db/migrations/068_rls_helpers_must_bypass.sql` line 95. Both inside
  comments, so harmless to the build; both shared files.

**Proved** (all run in `D:\fidato-equipment`, judged by exit code)
- `bash db/tests/run.sh` — **699 assertions, 95 migrations, exit 0**
  (648 before; `equipment register` 51/51). The first run failed 1: moving an
  item to another property was refused by the staff-scope trigger rather than
  the guard — the guard now fires first.
- `cd api; npm test` — **545 passed, 36 files, exit 0** (425 before;
  equipment 120).
- `npx vitest run` — **264 passed, 26 files, exit 0** (255 before; 9 new).
- `npx tsc -b --force` — exit 0. `cd api; npx tsc --noEmit` — exit 0;
  `strip-check` 73 files.
- `npm run build` — exit 0, "no test sign-in in dist".
- **Guards seen to refuse:** the server's role check taken out → **58 tests
  failed**, every refusal at every door; `stores` added to the server's
  `create` list → **1 test failed**, naming the action; the page guard taken
  off `/h/:code/equipment` → the revenue-manager refusal test failed.
- **Opened the screen** — my copy's API (8797, database `fidato_equipment`,
  the demo loaded) and website, started from a shell on the owner's yes (the
  preview tool read the Store chat's folder). As the owner: the empty register;
  added a TV in room 204 with no cost (every untyped figure a dash, history
  "Added in Room 204, in use · Group Owner"); added 12 kettles at ₹1,200
  (₹14,400 · ₹1,200 each); moved 2 to room 205 (landed on the new line: "Moved
  2 from Room 204 to Room 205", "2 taken from the line in Room 204", the reason
  kept); retired the TV (who, when, why shown; every action disabled with "A
  retired item is kept exactly as it was retired."); the Import dialog opens.
  At 1280: Equipment sits after Store in the menu, one primary button, no
  sideways scroll. At 375: cards, nothing outside the screen, no sideways
  scroll. As Reception: the list reads, Export · Import · Add disabled, with
  who may. **Fixed from what I saw:** the empty state's "Add the first" was a
  second primary button (now secondary, as the Store's); the two filter
  selects were 36px on a phone (now 44px). After both: types exit 0, web
  264 passed exit 0, build exit 0.
- **Seen in the console, not mine:** every page load in a worktree copy logs a
  403 for the Inter font — Vite will not serve `D:\fidato pms\node_modules`
  through the junction, which is outside the copy. The page falls back to
  another font. Development only; affects every lane's copy.

**Left open**
- **The retirement approval was not clicked through on screen** — the dev
  sign-ins are Owner, GM and Reception, with no Hotel Manager. It is proven
  through the API (`register.test.ts`: the HM's request waits, the GM approves,
  the record names both).
- **Working menu** — Housekeeping, the owner's answer; the master adds it
  (pinned menus). **Places and suppliers door** — the master's. **EQ-2** — the
  master's.
- **Not asked, not built:** undoing a retirement made by mistake (a retired
  item never changes; re-adding it is the only way today), and changing an item
  from counted to tagged. Both are the owner's to decide if wanted.
- **Migration number** — 095 on this branch; the Store may also hold 095.

**Commits:** `b5a844c` (the register), and this line. Branch
`equipment/phase-1b`, for the master to merge. Claim released.
