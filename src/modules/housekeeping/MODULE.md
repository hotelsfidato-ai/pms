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
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

A housekeeper arriving in the morning opens the board and sees the rooms
waiting for them first. They tap a room once it is clean (the sparkle) and
again once it is inspected (the tick); a supervisor gives rooms to people.
When something is broken they raise a work order — most take no room out of
service. When a room cannot be sold (a broken shower, a refurbishment) it is
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

- `flows/OutOfOrderFlow.tsx` — take a room out of service, or put it back;
  opened from the board.
- The board also gives rooms to people (who cleans which room) and shows the
  housekeeper's Start here card.

## Server endpoints

All hang from `/api/hotels`, in two files mounted by
`api/src/modules/housekeeping/index.ts` in this order: `roomStatus`,
`housekeeping`. Both arrived in the server split of 15 September (`3ca215d`):
`housekeeping.ts` moved whole; `roomStatus.ts` was cut out of the core's
`api/src/routes/property.ts`, as the plan said.

**`api/src/modules/housekeeping/housekeeping.ts`** (was `api/src/routes/housekeeping.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/housekeepers` | who can be given rooms — everyone with access to the property, housekeepers first |
| GET | `/:code/housekeeping/assignments` | whose rooms are whose, for a date (the business date if none is asked) |
| PUT | `/:code/housekeeping/assignments/:number` | give a room to a person |
| DELETE | `/:code/housekeeping/assignments/:number` | take it off them |
| GET | `/:code/work-orders` | what needs fixing |
| POST | `/:code/work-orders` | raise one |
| PATCH | `/:code/work-orders/:id` | change its state or who has it; closing one needs a line saying what was done |

**`api/src/modules/housekeeping/roomStatus.ts`** (the housekeeping part of
the core's `api/src/routes/property.ts`)

| Method | Path | What it does |
|---|---|---|
| PUT | `/:code/rooms/:number/housekeeping` | set clean, dirty or inspected |
| POST | `/:code/rooms/:number/block` | take a room out of service (reason, from, to, note); refused while a guest is in it; sets the room out of service when the block starts today or earlier |
| DELETE | `/:code/rooms/:number/block/:id` | put it back — deletes the block and sets the room to needs cleaning |

10 endpoints. None of them checks the caller's role in the route — only the
hotel's own row-level isolation applies (checked 15 September; `nav.ts` says
the same of work orders). The rooms list, `GET /:code/rooms`, stayed in the
core's `api/src/routes/property.ts` beside the hotel's details (`GET /:code`);
the plan does not name it. There is no `api/test/modules/housekeeping/` yet;
new server tests go there.

## Data

`src/modules/housekeeping/data/`:

| File | What it does |
|---|---|
| `housekeeping.ts` | the board (`listHousekeeping` — rooms from the core, stays from front desk), marking a room (`markRoom`, which hands the write to the core's `setHousekeeping`), whose rooms are whose (`listHousekeepers`, `listRoomAssignments`, `assignHousekeeper`, `unassignHousekeeper`), and work orders (`listWorkOrders`, `raiseWorkOrder`, `updateWorkOrder`) |

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
| `work_orders` | what needs fixing | `058_work_orders.sql` (`app.work_orders_open`; a trigger keeps the room in the same hotel), `062_idempotency.sql` (`idempotency_key`, so a held tap sent twice lands once) |

`room_status_log` (`003_rooms.sql`) exists, but no endpoint writes to it
(grep of `api/src`, 15 September).

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts`.

## Front door

`index.ts` exports nothing yet (`export {};`), and no other service imports
`@/modules/housekeeping` (grep, 15 September). Add an export only when
another service needs one, and only through this file.

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

- **Housekeeping never refreshes itself — deferred by the owner** on
  8 September: *"leave this for now and keep this in the upcoming files."*
  (PENDING § 3; MEMORY 218). The fix is known and small (below) — do not
  build it unasked.
- **The housekeeper's working menu is Housekeeping · Work orders · Store,
  with no Dashboard** — the Dashboard carries revenue, and their day starts
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

- **No refresh of any kind (defect 218) — deferred by the owner.** A
  housekeeper marks 204 clean and the supervisor's board does not change
  until a reload. Measured: five requests, none duplicated, all under 15 ms —
  not slow. The known fix: extend the Postgres `NOTIFY` trigger from
  `075_live_orders.sql` to housekeeping changes and add `useLiveOrders`-style
  invalidation to the board (PENDING § 3).
- **Worth asking the owner:** the housekeeper's list has no Rooms screen —
  approved as listed, one search away (PENDING § 5a).
- **Defect 243's shape in these routes has not been checked** — a refusal
  written below a write keeps the write (PENDING § 2 and § 5).
- **Room status and blocks are called from the core's `rooms.ts`** although
  their endpoints now live here — see Data. Moving the calls is a change to
  the core, so it is the core owner's to agree.

## Gates

Before the first edit: claim this service in `HANDOVER.md` → Folder claims
(service, branch, date), and work in your own worktree with your own
database and ports — how, in `AGENTS.md` ("Before your first write"); the
rules for parallel agents, in `docs/SERVICE-FOLDERS-PLAN.md`.

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

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the housekeeping agent does it.
