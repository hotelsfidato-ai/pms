# Housekeeping

Which rooms need cleaning, whose they are, what needs fixing, and which rooms
are out of service.

**Folder name:** `housekeeping` — the same word in all three places:

```
src/modules/housekeeping/          the screens, their data calls, their tests
api/src/modules/housekeeping/      the server's routes for this service
db/tests/modules/housekeeping.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged — and brought up to date on
branch `housekeeping/room-card-labels` on 17 September, for the room card's
words (D17-8) and phase 2B, repairs on equipment. Where the code could not
settle something, it says so.

## What it is

A housekeeper arriving in the morning opens the board and sees the rooms
waiting for them first. On each room they tap **Clean** once it is clean
(the sparkle) and **Inspected** once it is inspected (the tick); a grey one
says why when tapped. A supervisor gives rooms to people. When something is
broken they tap **Repair**, which raises a work order for that room — most
take no room out of service, so taking it out is a second choice inside.
A repair may name a tagged piece of equipment, which is "Under repair" until
the repair is closed; managers record what it cost, never without proof.
When a room cannot be sold (a broken shower, a refurbishment, NC) it is
taken out of service with a reason and dates, and put back later; it comes
back as needing cleaning, never clean. The board works on a phone on a
stairwell with the signal gone: taps are held and sent when it returns.

## Screens

Who works from each is `workingMenus` in `nav.ts` (the owner's menu of
15 September). Roles without a working menu see these in the full menu where
their permission allows; anyone whose permission allows can reach them with
Find a screen (Ctrl K).

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| Housekeeping (Front desk) | `/h/:code/housekeeping` | `pages/Housekeeping.tsx` | Housekeeping |
| Work orders (Front desk) | `/h/:code/work-orders` | `pages/WorkOrders.tsx` | Housekeeping |

Two addresses, two page files. Menu gates (`nav.ts`): Housekeeping needs
`inventory`; Work orders needs `room_config` **or** the housekeeping role
(`canSee` — housekeeping holds no `room_config` grant, MEMORY 260).

- **The room card** (`pages/Housekeeping.tsx`, 17 September, D17-8): three
  buttons with a word under each — **Clean**, **Inspected**, **Repair** — in
  three equal columns (98×56 at 375px). A grey one is `aria-disabled`, not
  `disabled`, so a tap reaches it and the card says why in one grey line
  (`role="status"`): "Room 202 is already inspected.", "Room 209 needs
  cleaning first.", "… on this phone, waiting to sync" for a held tap. A room
  already out of service shows one button, **Put back**.
- `flows/RepairFlow.tsx` — **Report a repair**, one dialog wherever a repair
  starts: the board's Repair (room fixed), Work orders' Raise one, and an
  equipment item's page (item fixed). What needs fixing, room, a tagged piece
  of equipment (optional; things in this room first; a thing waiting in the
  approvals inbox shown and not pickable), kind, priority. **Take the room out
  of service too** — unticked — takes it out with the repair linked; **Out of
  service without a repair** (board only) opens the dialog below.
- `flows/OutOfOrderFlow.tsx` — take a room out of service, or put it back;
  opened from the board's Put back, or from Report a repair.
- `flows/RepairCosts.tsx` — a repair's costs: each with its amount, who, when
  and **See the proof**; **Record a cost** (amount, proof file, note) and
  **Cancel this cost** (with a reason) for the five who may record.
- **Work orders** has an **Open · Closed** switch (the owner, 17 September):
  a bill that arrives after the fix is recorded under Closed. Each order names
  its equipment (linked to the item) and, for those who may see money, its
  cost — a dash when none stands. The list has its four states.
- `components/ItemRepairs.tsx` — **Repairs** on an equipment item's page:
  every repair on it, open and closed, the cost for those who may see it, and
  **Report a repair** (the kitchen and reception, who have no Work orders
  menu, report from there). Exported through `index.ts`; rendered by the
  equipment service's `pages/EquipmentItem.tsx`.
- The board also gives rooms to people (who cleans which room) and shows the
  housekeeper's Start here card.

## Server endpoints

All hang from `/api/hotels`, in three files mounted by
`api/src/modules/housekeeping/index.ts` in this order: `roomStatus`,
`housekeeping`, `repairs`. The first two arrived in the server split of
15 September (`3ca215d`): `housekeeping.ts` moved whole; `roomStatus.ts` was
cut out of the core's `api/src/routes/property.ts`, as the plan said.
`repairs.ts` is phase 2B (17 September).

**`api/src/modules/housekeeping/housekeeping.ts`** (was `api/src/routes/housekeeping.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/housekeepers` | who can be given rooms — everyone with access to the property, housekeepers first |
| GET | `/:code/housekeeping/assignments` | whose rooms are whose, for a date (the business date if none is asked) |
| PUT | `/:code/housekeeping/assignments/:number` | give a room to a person |
| DELETE | `/:code/housekeeping/assignments/:number` | take it off them |
| GET | `/:code/work-orders` | what needs fixing, most urgent first; `?view=closed` the 100 most recently closed; `?item=<id>` every repair on one piece of equipment. Each order names its equipment; `costs` and `costTotal` are sent **only** to the owner, admin, GM, Hotel Manager, Inventory Manager and accountant — absent, not empty, for anybody else |
| POST | `/:code/work-orders` | raise one; `equipmentItemId` names a tagged thing — refused (403) for a role outside the plan's "report a repair", refused in a sentence for a counted line, a retired thing, or one waiting in the approvals inbox — and sets it "Under repair" in the same transaction (D17-7). A retry with the same idempotency key returns the first |
| PATCH | `/:code/work-orders/:id` | change its state or who has it; closing one needs a line saying what was done; closing the **last** open repair on a thing sets it "In use" (D17-7); a closed repair is refused ("already closed") rather than re-closed over who closed it |

**`api/src/modules/housekeeping/repairs.ts`** (phase 2B, 17 September)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/repairable-equipment` | the tagged, unretired things a repair may point at, through equipment's front door; empty with `mayReport: false` for a role that may not report one |
| POST | `/:code/repair-costs` | a cost, as a form: `workOrderId`, `amount` (rupees, more than zero), `note`, `file` — **refused without its proof** (D17-6), for anyone outside the five (403), and for a file already proving a standing cost ("one bill proves one cost"). The proof is kept in `attachments` against the cost |
| POST | `/:code/repair-costs/:id/cancel` | cancel a wrong cost, with a reason; once. It stays on the record |

⚠ **The cost addresses are not under `/work-orders` on purpose.** `src/lib/offline.ts`
holds any write to a `/work-orders` address when the line is down, and a held
request keeps only a text body — a proof photo would be held without its photo.
`/repair-costs` is unlisted, so with no connection it is refused at once.

**`api/src/modules/housekeeping/roomStatus.ts`** (the housekeeping part of
the core's `api/src/routes/property.ts`)

| Method | Path | What it does |
|---|---|---|
| PUT | `/:code/rooms/:number/housekeeping` | set clean, dirty or inspected |
| POST | `/:code/rooms/:number/block` | take a room out of service (reason, from, to, note); refused while a guest is in it; sets the room out of service when the block starts today or earlier. `workOrderId` (Report a repair) links the block to that open repair for this room, so Work orders says "Room is out" |
| DELETE | `/:code/rooms/:number/block/:id` | put it back — clears any repair's link to the block, deletes it and sets the room to needs cleaning; "That block is not here." is refused before anything is written |

13 endpoints. The ten from before check no role in the route — only the
hotel's own row-level isolation applies (checked 15 September; `nav.ts` says
the same of work orders; API-2 is the admin chat's). The phase 2B doors DO ask
the role (`repairRoles.ts`): a repair naming equipment, and every cost door.
The rooms list, `GET /:code/rooms`, stayed in the core's
`api/src/routes/property.ts` beside the hotel's details (`GET /:code`).
Server tests: `api/test/modules/housekeeping/repairs.test.ts` (45).

## Data

`src/modules/housekeeping/data/`:

| File | What it does |
|---|---|
| `housekeeping.ts` | the board (`listHousekeeping` — rooms from the core, stays from front desk), marking a room (`markRoom`, which hands the write to the core's `setHousekeeping`), whose rooms are whose (`listHousekeepers`, `listRoomAssignments`, `assignHousekeeper`, `unassignHousekeeper`), work orders (`listWorkOrders` — which now THROWS a failure instead of returning an empty list, `listRepairsForItem`, `raiseWorkOrder`, `updateWorkOrder`), and phase 2B (`listRepairableEquipment`, `blockRoomForRepair`, `recordRepairCost` — its own `fetch`, because `api()` always sends a JSON content type and a file cannot be held offline — `cancelRepairCost`, `proofAddress`) |
| `../repairRoles.ts` | who may report a repair on equipment, record a cost, see one — a copy of the server's `repairRoles.ts`, held together by the API test |

The calls for room status and blocks are **not** in this folder: they live in
the core's `src/data/repositories/rooms.ts` (`setHousekeeping`, `blockRoom`,
`unblockRoom`, `BLOCK_REASONS`), which the board and `OutOfOrderFlow` import.
The server endpoints moved here (`3ca215d`); the web calls are still the
core's.

## Database

Tables this service writes (from the SQL in its route files), and the
migrations that made or changed them:

| Table | What housekeeping does to it | Migrations |
|---|---|---|
| `rooms` (`housekeeping_status`) | clean, dirty, inspected, out of service — kept apart from `occupancy_status` on purpose | `003_rooms.sql`; `070_vacating_dirties.sql` (a room somebody slept in turns dirty when it is vacated), `074_nobody_slept_there.sql` (a room nobody entered does not) |
| `room_blocks` | a room out of service, with its reason and dates | `022_room_blocks.sql` (and `app.sellable_rooms`, which leaves blocked rooms out of the sellable house) |
| `housekeeping_assignments` | whose room is whose | `035_housekeeping_assignment.sql` |
| `work_orders` | what needs fixing | `058_work_orders.sql` (`app.work_orders_open`; a trigger keeps the room in the same hotel), `062_idempotency.sql` (`idempotency_key`, so a held tap sent twice lands once), **repairs on equipment** (`equipment_item_id`: one TAGGED item at the same property, chosen when the repair is raised and never changed; `block_id` is now set by Report a repair) |
| `work_order_costs` | what a repair cost | **repairs on equipment** — amount > 0; `proof_id` NOT NULL and a trigger that refuses any proof not kept against THIS cost; never edited; cancelled once with who, when and why; DELETE revoked; RLS forced; the shared audit trail |
| `attachments` | the proof photo of a cost (`subject_table = 'work_order_costs'`) | `077_attachments.sql` (the core's) |
| — (announces) | `rooms` (cleaning state, occupancy), `room_blocks`, `housekeeping_assignments`, `work_orders`: each change raises `<hotel id>:housekeeping` on the live channel `pos_changed` | **housekeeping changes are announced** (`103_…`, 17 September, HK-1) |

The migration is `db/migrations/102_repairs_on_equipment.sql` — **refer to it by
what it does**; renumbered 102 by the master at merge (099 to 101 were taken). Its
database checks: `db/tests/modules/housekeeping.sql` (18). It replays (rerun.sh).
Equipment's status is **not** written by a trigger here: D17-7 goes through
equipment's front door, from the API.

`room_status_log` (`003_rooms.sql`) exists, but no endpoint writes to it
(grep of `api/src`, 15 September).

A new migration takes the next number after cp6's highest when it is written
(plan § 7); the guard is `src/test/migrationNumbers.test.ts`.

## Front door

`index.ts` exports `ItemRepairs` (17 September) — a piece of equipment's
repairs, rendered by the equipment service's item page. Add an export only
when another service needs one, and only through this file.

## Leans on

- **front desk** — `listStays` (`data/housekeeping.ts`): who is in which room.
- **the core** — `src/data/repositories/rooms.ts` (the rooms list, room
  status, blocks); `src/lib/offline.ts` (connection state and the outbox the
  board shows); `src/components/app/StartHere.tsx` (the card).
- **the database** — front desk's check-out, move, exchange and unassign
  reach the board through 070's trigger (the vacated room turns dirty), not
  through any import; a void, a cancellation or a no-show gives the room back
  as clean as housekeeping left it (074), and a room out of service stays out.

## Rules that bind it

- **The board refreshes itself — the owner, 17 September evening, D17-39**
  ("build it now"; it had been deferred on 8 September, MEMORY 218). The way
  Tables and the Kitchen do: told the moment a room changes, with a slow poll
  underneath. **Half built on 17 September** — every change announces itself
  from the database, and the board polls every 30 seconds; the live half waits
  on the master (Requests from this service). **D17-40: the assignee dropdown
  on each card stays as it is.** **D17-38: closing a repair while its item's
  request waits is refused, as built.**
- **The owner's answers of 17 September** (`docs/briefs/decisions-2026-09-17.md`,
  and the questions asked the same morning) — build to them, do not re-ask:
  - **D17-8** the room card's words are **Clean · Inspected · Repair**, and a
    grey one says why when tapped. **Repair** reports a repair for that room;
    taking the room out of service is a second choice inside it.
  - **D17-9** no "Needs cleaning" section is built. (The board's existing
    Needs cleaning group, shown when rooms need cleaning, is unchanged.)
  - A room already out of service: its button says **Put back**.
  - **D17-5** a repair cost is recorded by the Hotel Manager, Inventory
    Manager, GM, admin or owner; **D17-6** with no approval, but never without
    proof; **D17-7** opening a repair on an item makes it Under repair,
    closing it makes it In use — through equipment's front door.
  - A repair points at **tagged items only**; a thing **waiting in the
    approvals inbox is refused**, with the sentence (applied to closing too —
    see Open items); **several costs** per repair, each with its proof; a wrong
    cost is **cancelled with a reason**, never deleted; costs and proof are
    seen by the five **and the accountant** only.
  - Work orders gets **Open · Closed**, so a late bill is recorded; the item's
    repairs show **on its page**, written by this service and reviewed by the
    master; equipment's front door for repairs was **written here** on the
    owner's yes, for the master to review.
- **The housekeeper's working menu is Housekeeping · Work orders · Store ·
  Equipment, with no Dashboard** — the Dashboard carries revenue, and their day starts
  at their own work (owner, 15 September; `HANDOVER.md` § 3.2;
  `navigation.ts`). Housekeeping lands on the board (`workingHomeFor`).
- **Work orders are shown to housekeeping with `canSee`, on the owner's yes;
  no permission changed** (MEMORY 260, 15 September).
- **A shorter menu keeps everything reachable by search** (owner,
  15 September). A new screen goes into the housekeeper's working menu or it
  is search-only for them (`HANDOVER.md` § 3.2).
- **Start here, the housekeeper's card** (`src/components/app/startHereCards.ts`),
  on `/h/:code/housekeeping` only (`START_HERE_ON`): "See what needs cleaning
  — Rooms waiting for you are listed first, under **Needs cleaning**"; "Mark
  a room clean — On the room, tap **the sparkle** once it is clean, **the
  tick** once it is inspected"; "Report something broken" (`/h/:code/work-orders`)
  — "**Raise one**, say which room and what is wrong." Change a button, change
  the card (`HANDOVER.md` § 3.3).
- **Room states, one set of words** — "Needs cleaning", "Out of service";
  housekeeping once had a third set of its own (`HANDOVER.md` § 6; MEMORY 258).
- **Every list has four states — loading, failed, empty, full**; the board
  had none of the first three until 15 September (`HANDOVER.md` § 6;
  MEMORY 269).
- **No default prices; a missing figure is a dash, never a zero**, and never
  show a figure the database has not agreed to (`HANDOVER.md` § 5).
- **With the line down** (`src/lib/offline.ts`, core; guarded by
  `src/lib/offline.test.ts`): room status, assignments and work orders are
  held and sent later; taking a room out of service or putting it back is
  not named there, so it is refused. A held tap must survive a reload
  (MEMORY 49, 127). A device with no offline store at all — a private
  window, the test browser — reads as "nothing held here"; the board catches
  that failure rather than leaving it uncaught (`11d77a3`, MEMORY 274).
- **One main action per screen**: any new dialog must pass
  `src/components/ui/primaryAction.test.ts` (`HANDOVER.md` § 3.1).
- **Production deploys are the owner's** (`HANDOVER.md` § 5).

## Open items

From `PENDING.md`:

- **HK-1, the board refreshing itself (D17-39) — half built, 17 September.**
  Done here: migration `103_housekeeping_changes_are_announced.sql` raises
  `<hotel id>:housekeeping` on the live channel from triggers on `rooms`
  (cleaning state and occupancy), `room_blocks`, `housekeeping_assignments` and
  `work_orders`; and the board polls every 30 seconds (its rooms, the sheet
  and the blocks), keeping the rooms it has when a poll fails. **Measured:** a
  room changed from outside the browser moved on the open board 21.5 s later,
  no reload; with the API stopped the 18 rooms stayed and the line said
  Offline. **Not done:** being told the moment a room changes — the shared
  listener does not read a topic yet (Requests from this service).
- **Worth asking the owner:** the housekeeper's list has no Rooms screen —
  approved as listed, one search away (PENDING § 5a).
- **Defect 243's shape** — checked on 17 September in the work order routes,
  the block routes and every new route: each refusal now sits above the first
  write. The assignment routes were not re-read.
- **Room status and blocks are called from the core's `rooms.ts`** although
  their endpoints now live here — see Data. Moving the calls is a change to
  the core, so it is the core owner's to agree. (`blockRoomForRepair` in this
  folder is the one block call that is not the core's — it carries the repair.)
- **Equipment's own "Under repair / Back in use" button** still sets the
  status by hand, with a repair open or not. Equipment's page; not changed.
- **Work orders prints the priority words and categories as stored**
  ("maintenance", "it") — unchanged, and not in the owner's answers.

## Gates

Before the first edit: claim this service — `npm run claim -- housekeeping
"what you are doing"` in your copy's folder (release it when you stop) — and
work in your own worktree with your own database and ports — how, in
`AGENTS.md` ("Before your first write").

```
# the PC, in your worktree's folder (PowerShell or Git Bash)
npx tsc -b                      # web types — no output at all
npx vitest run                  # web tests
cd api && npx tsc --noEmit      # server types
cd api && npm test              # server tests — never `npx vitest run` inside api/ (MEMORY 196, 221, 264)

# the PC, Git Bash, in your worktree's folder — needs the local Postgres (HANDOVER.md § 7)
db/tests/run.sh                 # every database check, on a scratch database
db/tests/rerun.sh               # only if you added a migration: it must run twice
```

⚠ A fresh worktree has no copy of the main folder's untracked `.env`;
`AGENTS.md` ("Before your first write") gives your copy a `.env.local` with
`VITE_API_URL` and `VITE_ALLOW_DEV_AUTH=1`. Measured at `c804aa2` in the
worktree this brief was written in: with no env file, `npx vitest run` failed
31 of 204 (19 in `src/App.test.tsx`, 10 in front desk's, 2 in reports');
with only `VITE_ALLOW_DEV_AUTH=1` it still exited 1; with that and
`VITE_DEMO_MODE=1`, 4 of 204 failed, all in `src/App.test.tsx` (not
investigated). A gate's answer is its exit code (MEMORY 274). Never print an
env file.

The guards this service must respect:

- `src/test/boundaries.test.ts` — another service is reached only through its
  `index.ts`; every service folder keeps its `index.ts` and `MODULE.md`.
- `src/test/migrationNumbers.test.ts` — one number, one migration.
- `src/components/app/navigation.test.ts` — pins the housekeeper's working menu.
- `src/components/ui/primaryAction.test.ts` — every dialog declares its main
  action.
- `src/lib/offline.test.ts` — which writes may be held offline.
- `src/App.test.tsx` — "start here" ("shows a housekeeper theirs on the
  board").
- `src/modules/housekeeping/housekeeping.test.tsx` — the card's words, a grey
  tap's sentence, Put back, Work orders' failed state (each seen to fail).
- `api/test/modules/housekeeping/repairs.test.ts` — every role at every repair
  door; Under repair / In use; costs with proof (seen to fail, 19 red).
- `db/tests/modules/housekeeping.sql` — what the database refuses.
- `api/test/modules/housekeeping/live.test.ts` — every change the board shows
  announces `<hotel>:housekeeping`, never a bare hotel id (seen to fail, 5 red).
- `housekeeping.test.tsx` "the board refreshes itself" — it reads the rooms
  again on its own, and keeps them when that read fails (seen to fail both ways).

## Requests from this service

For the master, 17 September — each is a file this service may not change:

- **DONE by the master, 17 September — the live channel carries a topic.**
  `realtime.ts` reads `<hotel id>:<topic>` (a bare id is `orders`), the stream
  sends the topic, `useLive(hotelId, topic, keys)` in `src/lib/useLiveOrders.ts`
  invalidates only its own keys, and the board is wired (floor 60 s while live,
  30 s otherwise). Proved: `api/test/live.test.ts` names the topic, failing on the
  old code; a room set dirty in the database appeared under "Needs cleaning" on an
  open board without a reload. The request as written, kept below for the record.
- **The live channel carries a topic — so the board is told the moment a room
  changes (HK-1, the owner's D17-39, 17 September evening).** Asked by the
  housekeeping chat. The housekeeping half is on branch
  `housekeeping/live-board`; what it needs from the core:
  1. `api/src/realtime.ts` — read the payload as `<hotel id>` or
     `<hotel id>:<topic>`. A bare id is the topic `orders`, so 075's triggers and
     every POS screen are unchanged. Watchers are still keyed by hotel and are
     told the topic. Today `fanOut(msg.payload)` looks up the WHOLE payload, so
     `<hotel id>:housekeeping` reaches nobody — which is why the housekeeping
     migration is safe to merge before this.
  2. `api/src/routes/live.ts` — `event: changed` with `data: <topic>` (it sends
     `"1"` today).
  3. `src/lib/useLiveOrders.ts` — invalidate the POS keys only for `orders`,
     so a room marked clean does not refetch every till and kitchen in the
     hotel; and a hook for a topic and its keys, e.g.
     `useLive(hotelId, "housekeeping", keys)`, reusing the same reader,
     reconnect and 350 ms debounce rather than a second copy of them.
  4. `api/test/live.test.ts` — a topic reaches its own screens and no others.

  **Then the board's wiring** (this service's, a few lines, or the master's at
  merge): `const { live } = useLive(hotelId, "housekeeping", [["housekeeping"],
  ["hk-assignments"], ["rooms"], ["work-orders"], ["item-repairs"]])`; the
  floor becomes `live ? 60_000 : 30_000` like the Kitchen's; the Online line
  says live or reconnecting as the Kitchen does. ⚠ `["rooms", hotelId]` is also
  the front desk's `AssignRoomFlow` key — refreshing it when a room turns dirty
  is right (the room's state is the tape chart's too), but it is the master's
  to agree.

  **If a second channel is preferred** (`housekeeping_changed`): the one
  listening connection can `LISTEN` on both; the housekeeping migration changes
  in one line.

- **Review two edits in equipment's folder**, made on the owner's yes:
  `api/src/modules/equipment/repairs.ts` + its three exports in `index.ts`
  (the repair door), and `pages/EquipmentItem.tsx` (renders `ItemRepairs`).
  Equipment's `MODULE.md` still says "Under repair is by hand" — stale.
- **The Start here card** (`src/components/app/startHereCards.ts`) says "tap
  the sparkle … the tick". Still true; the buttons now also say **Clean** and
  **Inspected**, and **Repair** reports a repair where the card sends people to
  Work orders. The words are the master's to change.
- **`ROOM_TONES`** (`src/components/ui/StatusPill.tsx`) gives `clean` and
  `inspected` the same colour — the two states the board exists to tell apart
  (the critique).
- **`db/migrate.sh`**: its failure summary is filled by NOTICE lines before the
  real ERROR, and `--with-dev-identities` prints a green ✓ after an ERROR.

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the housekeeping agent does it.
