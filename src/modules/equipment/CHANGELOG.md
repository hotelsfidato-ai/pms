# Changelog — Equipment

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md` — the master's.

---

## 2026-09-16 (part 2) · S12–S16: the Inventory Manager, leaving the store, one inbox

**Asked for:** the owner — merge cp6, rename the migration from 095 to 097,
re-read the brief and do the new parts: the Inventory Manager in `grants.ts`,
"leaving the store needs approval", retirement approvals in the shared inbox.
Tell the master the branch.

**Merged cp6** (`5c19f45`) with the register's migration renamed to **097** inside
the merge commit, so no commit holds two 095s. The master's 095 and 096 came with it.

**Asked the owner first, every recommendation taken:** a move that needs no
approval is for anybody who may **edit**; part of a count leaving the store is
**split off when asked**; store → store needs **nobody**; names in the history are
seen by **whoever may approve**, a dash for everybody else.

**Shipped**
- **Migration "the equipment register" (097), redesigned.** No place column: an
  item's place is **worked out** from `equipment_moves` — the latest move that
  needed no approval or whose approval is `approved` (`app.equipment_place`).
  Retired is worked out too (`app.equipment_is_retired`). The core inbox records
  a decision and performs nothing (076), so nothing is ever copied from it; a
  refusal leaves the thing where it was. The database refuses a move out of a
  store with no request while the rule is in force, a borrowed approval,
  anything while a request waits, and any change to a retired thing.
- **Server** — moves out of a store need only **view** (S15) and a reason, and
  raise `equipment_issue` with `app.request_approval`; other moves need **edit**. A
  Hotel Manager's tagged retirement raises `equipment_retire` (S16). **My own
  approve and decline routes are removed** — deciding is the core endpoint's.
  History merges events, moves and requests with their decisions; names through
  `app.colleague_name` for approvers only.
- **`grants.ts`** — the Inventory Manager (`stores`) in create, edit, approve;
  refusals say "the Inventory Manager".
- **Screens** — the list shows what waits in the inbox beside the thing, with
  Approve and Refuse only where the queue says `mayDecide` (`flows/Decide.tsx`),
  otherwise its `blockedBecause`; pills for waiting and refused. The item page:
  waiting and refused banners, "Ask to take out" for somebody who may only look,
  decisions in the history. The move dialog explains an ask and requires why.
- **Menu** — `workingMenus: ["stores"]`; the brief's second permitted line in
  `navigation.test.ts`: `menu("stores")` reads Store, Equipment, Notifications.
- `importColumns.ts` — the template's columns in a file with no imports (EQ-4).
- `MODULE.md` rewritten; `DEFECTS.md` EQ-4 and EQ-5.

**Found**
- **EQ-4, mine** — my first commit broke `cd api; npx tsc --noEmit`, and its
  changelog said exit 0: I ran it before writing the test that broke it. Fixed.
- **EQ-5, mine** — the ask dialog read "Move" and "Optional" for Reception until
  a room was chosen. Found on the screen, fixed before commit.
- **Not mine:** the night-audit screen test failed once in a full web run on a
  loaded machine (139s instead of 36s) and passed alone and in two full re-runs —
  a 1-second `findByRole` wait under load.

**Proved** (run in `D:\fidato-equipment` on the committed tree, judged by exit code)
- `bash db/tests/run.sh` — **733 assertions, 97 migrations, exit 0**
  (equipment register 69, the master's equipment approvals 10).
- `cd api; npm test` — **739 passed, 38 files, exit 0** (equipment and the
  master's `equipmentApproval.test.ts`: 164).
- `npx vitest run` — **265 passed, 27 files, exit 0**. `npx tsc -b --force` exit 0.
  `cd api; npx tsc --noEmit` exit 0; strip-check 74 files. `npm run build` exit 0,
  "no test sign-in in dist".
- **Guards seen to refuse:** the server skipping the request → the **database**
  refused every move out of the store ("waits for the Inventory Manager"), 7 tests
  failed; a Hotel Manager's retirement sent straight through → 4 failed; names
  given to everybody → 1 failed; a waiting move counted as done in
  `app.equipment_place` → 4 failed.
- **Opened the screen** (my API and website, my database rebuilt with a dev store,
  lobby and a test Inventory Manager): as **Reception**, only *Ask to take out*
  offered, with who may; asked for a fridge to room 204 — it stayed in the store,
  "Waiting to leave the store", and the inbox's own "You asked for this one…". As
  the **Inventory Manager**: working menu Store · Equipment · Notifications; the
  request on the list with who asked and why, one primary button; **Approve** →
  the fridge reads Room 204. Reception asked for 2 of 12 kettles to the lobby
  (split off); the Inventory Manager **refused** on the item page with a reason →
  "Refused — taking it to Lobby (dev): … It is still here", the decision in the
  history. At **375px**: nothing off screen, no sideways scroll, controls 44px.
  Console: only the known Inter font 403 in worktree copies.

**Left open**
- **The Hotel Manager → Inventory Manager retirement was not clicked on screen**
  (no Hotel Manager dev sign-in); proven through the API.
- **Master:** Housekeeping's working menu; the shared door for places and
  suppliers (without it no real property has a store to leave); EQ-2.
- **Not asked, not built:** undoing a retirement; counted ↔ tagged.

**Commits:** `5c19f45` (merge, 097), and the commit carrying this entry. Branch
`equipment/phase-1b`, for the master to merge.

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
