# Front desk — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-24 · Follow-ups A-I: the in-house rule everywhere, a future move's room, controls the server refuses, the guest's messages, own access

**Asked for:** the master, for the owner's answers of 24 September (D24-15,
D24-16, D24-17, and a web test): branch `front-desk/follow-ups-24sep`.
**A** - moving a guest into a room, or assigning one, where `app.in_house`
says somebody is still in it is refused with FD-11's words; the walk-in's
refusal names the guest; fixed where every caller passes. **B** - a move
booked for a future day dirties the old room when that day comes. **C** -
the early check-in waive tick only for those the server lets waive. **D** -
the guest's page lists their messages, Sent or Handled. **E** - a web test
for the group panel's lead button. Added the same afternoon: **F** (D24-18) -
a control the server refuses is hidden: "Assign room" on the Rooms board for
housekeeping; **G** (D24-19) - a GM or a hotel's Admin may not switch their
own access off on People; **H** - a refused access removal said "They did
not have access"; **I** - close FD-6's note and the `PERSISTED` request.

**The owner's answer in this chat** - asked whether A also refuses a room
given ahead (this morning, for this afternoon's arrival, while the room's
guest leaves at 11) or a move for a later night: **"Only when they go in
now"** - refused: check-in, walk-in, a move or swap from tonight, a room for
a guest already checked in; allowed: a room given ahead to a booking not yet
here, and a move for a later night (the check-in still refuses on the day).

**Shipped**
- **A** - `stillIn()` in `api/src/modules/front-desk/operations.ts`: FD-11's
  query and sentence, once. Asked by the check-in (as before), the walk-in
  (was "Somebody is already in that room."), the move (a checked-in guest,
  from the business date or earlier), the assign (a guest already checked
  in) and the swap in `stayExtras.ts` (from the business date or earlier;
  neither of the two counts) - each above its first write (MEMORY 243).
- **B** - `db/migrations/137_future_move_room_is_dirty.sql` (cp6 took 134
  to 136 while this ran): the business date moves in one place, a night audit run
  becoming `completed`, so a trigger there asks 130's question for the new
  date. New function and trigger; no earlier function changed (MEMORY 317).
- **C** - `GET /:code/early-arrival` answers `mayWaive` (the server's own
  `mayWaive`, for the caller); `CheckInFlow` draws the tick from it instead
  of `can(role, "approve", "reservation")`. Who may waive is unchanged.
  (The server decides waiving in `mayWaive`, not in `api/src/permissions.ts`
  or `roleGate.ts`, so the screen asks it rather than copying a list.)
- **D** - online-checkin's `MessageTheDesk` (its CHANGELOG has the entry).
- **E** - `src/modules/reservations/groupLead.test.tsx` (its CHANGELOG).
- **F** - `pages/StayView.tsx` draws "Assign room" only for a role the
  matrix gives `reservation: edit` - the question roleGate's `ROOMING` asks
  of `/stays/:id/assign`, from the same matrix (`api/src/permissions.ts`,
  which the website re-exports). Who may do what is unchanged.
- **G, H** - `api/src/modules/admin/admin.ts` and `admin/pages/People.tsx`;
  admin's ADM-8 has the whole of it.
- **I** - MODULE.md's `PERSISTED` request and DEFECTS.md's FD-6 "Still true
  after this" closed: the admin lane's merge keeps `stay-view` (D22-23).

**Found**
- **FD-17** (open) - a booking taken out of its room still shows that room
  (`GET /stays/:id` and the Rooms tile: Lata Bhosale on 204 after "Take them
  out of the room").
- Controls on these screens the server refuses for housekeeping, seen as
  the Housekeeping sign-in (F asked for a list, not a sweep): a free room's
  tile opens the Walk-in form (a walk-in is `reservation: create`); the
  Calendar's 238 "Book room" cells (the same); the stay panel's "Settle and
  check out", "Mark VIP" and "More options" (change dates, move, exchange,
  inclusions, void - all `reservation: edit` or `cancel`).
- **FD-16** (open, DEFECTS.md) - the check-in's and the swap's fallback date
  is `hotels.business_date`, which never moves once a night audit has run;
  the screens send their own date, so only a hand-sent call is behind.
- The late check-out's waive tick still asks the role (FD-14's note); the
  same `mayWaive` answer would do it and D24-18 reads as covering it. Not
  done - not in A-E.

**Proved** (this copy, database `fidato_s5`, API 8813, web 5213)
PROOF_PLACEHOLDER

**Left open** - FD-16, FD-17; the late check-out's tick and the
housekeeping controls above (D24-18 reads as covering them); changing your
own role on People (ADM-8); FD-10 and FD-12 as before.
A move dated for a later night into a room whose late-checkout guest has
still not left when that night comes goes through with no refusal (nothing
is written that night; the owner's scope allows it ahead of time). The demo
setup used for the screens (Lata Bhosale's advance room on 204 taken off;
5EL's check-in hour 23:30 and a ₹500 early charge; the "Admin" dev sign-in
made a 5EL-only administrator; a guest link unlocked with a code put in by
hand, as the door's tests do) lived only in `fidato_s5`, now dropped.

**Commits:** COMMITS_PLACEHOLDER

---

## 2026-09-24 · The three stopped branches finished; early check-in works again (FD-15, FD-14)

**Asked for:** the master, for the owner - finish and prove the three
branches the owner stopped on 23 September (`front-desk/fd11-fd9-wording`,
`guest-messaging/group-lead`, `online-checkin/message-the-desk`), on one
branch, `front-desk/finish-24sep`: D23-11 wording, D23-12 (FD-11, FD-9),
D23-13 (FD-13), D22-52/53/10 (a group's lead), D23-14 (message the desk).

**Shipped**
- The three merged onto cp6; their migrations numbered **130** (a moved-out
  room is dirty), **131** (a group's lead), **132** (a message to the desk).
  Nothing of cp6's was overwritten; no conflict.
- **FD-15 (found today, fixed with the owner's yes)** - the check-in screen
  never sent the early-arrival reason or the waive, so every check-in from
  the screen before the check-in hour was refused since 4 September.
- **FD-14 (the owner's yes)** - a clerk's waive of the early charge is refused
  before anything is written.
- **Guest messages in reception's menu** (the owner's choice for where the
  desk sees a guest's message, D23-14).
- The in-house rule's web test no longer imports `@/data/fixtures`: cp6
  itself failed the whole web suite on it (repositories.test.ts, Rule 2) -
  merged at 17:54 on 23 September, after the last full gate log (17:31).
- 131's new column carries no foreign key back to `reservations` (the
  property reset could not order the loop; `guest-messaging/CHANGELOG.md`).

**Found**
- ⚠ **A copy's own web server never sees its own edits.** `vite.config.ts`
  ignores `**/.claude/worktrees/**`, and every copy lives there - so Vite in
  a copy serves the files as they were when it started. The check-in screen
  kept sending the old body after the fix until the server was restarted.
  Restart a copy's web server after every edit (for the master's MEMORY).
- Stale claims: `front-desk` (the stopped fd11 helper) and `online-checkin`
  (`D:\fidato-guests`, 21 September) - left for the master.

**Proved** (this copy; its own database `fidato_s2`, API 8813, web 5213)
- Types: `npx tsc -p tsconfig.app.json --noEmit` exit 0; `cd api && npx tsc
  --noEmit` exit 0.
- API, whole suite: 87 files, 1408 tests, exit 0. Database: all 1093
  assertions, exit 0. Replay: all 132 migrations re-runnable, exit 0.
- Web, whole suite: 68 files, 617 tests, exit 0 (its first run, before the
  fixture-import fix, was 1 failed, 616 passed - Rule 2).
- Each guard seen refusing: FD-13's test without `gridRow: 1` (fails: the 14
  cells lose it); FD-11's check-in guard, the review's `notLead` and the lead
  route's "no longer stands" switched off (4 tests fail, "expected 200 to be
  409"); FD-9's trigger left out of the migration (database suite, "moved-out
  room" 1 failed, "got clean"); FD-15's two tests and FD-14's test before
  their fixes.
- Screens, `.local/screenshots/2026-09-24-front-desk/`, desktop and phone:
  `01-property-empty-*` (Empty 10, In house now 7), `02-properties-bookings-
  checked-in-*` ("8 bookings checked in - it cannot be closed until they check
  out."), `03-calendar-one-row-per-room-*` (all 17 rows 37px),
  `04-check-in-refused-*` ("Ganesh Patil (FH-2608-5004) is still in room 204.
  Check them out first, or choose another room."), `05-group-lead-*`,
  `06-group-messages-on-another-room-*`, `07-guest-page-message-*` (phone),
  `08-desk-*` ("2 unread"), `09-desk-marked-handled-*` ("Handled by Test
  Reception, 24 Sep 2026, 12:51 PM"), `10-early-check-in-with-reason-desktop`
  (Lata Bhosale into 209 at 13:16, before 14:00, "Overnight train" recorded).

**Left open** - as the 23 September entry below: a future-dated move is not
dirtied when its date arrives; the walk-in's refusal still names nobody; a
move or assign into a room a late-checkout guest is in is not refused (only
the check-in, as D23-12 said). And FD-14's note: a hotel-level administrator
sees the waive tick and is refused.

**Commits:** merges `7c7d89b`, `891790f`, `e938205`; `1ce2d3f` (numbers),
`9260945` (FD-15, FD-14), `252658c` (menu), `3cb7c36` (no foreign key),
`2594de6` (the fixture import), and the notes.

---

## 2026-09-23 · FD-11, FD-9, FD-13 and the D23-11 wording

**Asked for:** the master, for the owner's D23-11 (wording), D23-12 (FD-11
and FD-9 fixed) and D23-13 (FD-13 fixed). Branch
`front-desk/fd11-fd9-wording`.

**Shipped**
- **FD-11** - the check-in route refuses a room somebody is still in, by
  `app.in_house`, above its first write: "Ganesh Patil (FH-2608-5004) is
  still in room 204. Check them out first, or choose another room." Shown as
  the check-in screen's "Could not check in" toast, like every refusal.
- **FD-9** - a new migration, `130_moved_out_room_is_dirty.sql` (the master
  renumbers at merge): a trigger on a new room assignment dirties the room
  the same checked-in stay was moved out of, on or before the business date,
  when it is clean or inspected and nobody is in it by `app.in_house`. No
  earlier function changed.
- **FD-13** - `gridRow: 1` on the Calendar's empty cells; every room row is
  one row tall.
- **D23-11** - the property page's "Vacant" reads "Empty"; the Properties
  list reads "8 bookings checked in - it cannot be closed until they check
  out." (singular "1 booking checked in"). Those two places only
  (`admin/pages/Property.tsx`, `admin/pages/Properties.tsx`).

**Found** - FD-14 (DEFECTS.md, open, found by reading): the check-in's
"waive the early charge" refusal sits below its writes, so a refused waive
is still a check-in, with no early charge. Not fixed - outside D23-12.

**Proved** - FD-11: `api/test/modules/front-desk/inHouseRule.test.ts` 8/8;
with the guard switched off, 1 fails ("expected 200 to be 409" - the second
guest is checked in), 7 pass. FD-9: `db/tests/modules/front-desk.sql`
"moved-out room" 6/6; with the trigger dropped, 1 fails ("got clean").
FD-13: `front-desk.test.tsx` "keeps a room with a booking one row tall" -
fails without the fix (14 cells, grid-row empty), passes with it.
Screens, on this copy's own database (`fidato_fd11`, API 8797, web 5183),
in `.local/screenshots/2026-09-23-fd11/`: `01-property-page-empty.png`
(Empty 10, In house now 7), `02-properties-bookings-checked-in.png`,
`03-calendar-one-row-per-room.png` (every room row measured 37px),
`04-check-in-refused-guest-still-in-room.png`.
Gates here: none - the helper was stopped before its gate run. Finished and
proved on 24 September in the merged copy (the entry above).

**Left open** - a move dated in the future is not dirtied when the business
date reaches it (no write happens then); the walk-in still says "Somebody is
already in that room." without the name; a move or an assign into a room a
late-checkout guest is still in is not refused (only the check-in is, as
D23-12 said). Questions in the master's report.

---

## 2026-09-22 · One rule for In house and Empty (D21-36, D21-37), and FD-8

**Asked for:** the master, for the owner's D21-36 and D21-37 - one
definition every screen reads, and a test that fails if any screen
disagrees; and FD-8, found and fixed at its root.

**Shipped** - the rule is in the database (the one in-house rule migration,
numbered 129 on this branch for the master to renumber): `app.in_house`
(every stay checked in and not checked out, whatever its departure date, in
the room `app.room_for` gives on the business date) and `app.house_now`
(every room: in house, out of order - a block covering tonight - or Empty).
`GET /:code/house-now` serves it. Rooms, the Dashboard's The house now, In
house (its badge), the property page (In house now and Vacant) and the
housekeeping board (its In house group) read it and count nothing themselves.
The counts are ROOMS. `rooms.occupancy_status` is set from `app.in_house` by
070's two triggers (new bodies) and a new one on a stay's status, and
corrected once for every room; the check-in and walk-in no longer write it.

**Found** - FD-8's cause (DEFECTS.md): 070 set the column `occupied` on any
live assignment, so every room given in advance to a later booking was
"occupied" - 208 and 307 in the demo - and a room left by a mid-stay move
stayed "occupied". Also FD-9 (a mid-stay move never dirties the room left),
FD-10 (a room nobody entered is dirtied when its advance booking lets it go),
FD-11 (a check-in does not ask whether a late-checkout guest is still in the
room), FD-12 (a room checked out of stays clean while a later booking holds
it). On the demo, 25 August: 8 checked-in bookings in 7 rooms (201 holds
FH-2608-4857, due out, and FH-2608-4858, arrived into it) - so In house is 7
rooms, Empty 10, Out of service 1.

**Changed for housekeeping** - only what reading the rule needs: the board's
In house group is every room with a guest in it (a guest's room marked out of
service sat in no group). What makes a room dirty is untouched.

**Proved** - `inHouseRule.test.tsx` 6/6 (all 5 screen tests fail with the
screens' own counting put back); `api/test/modules/front-desk/inHouseRule
.test.ts` 7/7 (6 fail with the walk-in and triggers put back);
`db/tests/modules/front-desk.sql` 16/16 (5 fail with the triggers put back).
Gates here: both type checks exit 0; the front-desk, reports, housekeeping and
App web tests 105/105 exit 0; `db/tests/run.sh` 981/981 exit 0; `rerun.sh`
125 re-runnable exit 0; the API suite twice, 1297/1298 each, a different
order-dependent test failing each time (`guestDoor.test.ts`, which the
master's own gate log of 22 September shows failing too, then
`guest-messaging/messages.test.ts`), both files run before this one's; then,
with 074's dirty guard put back exactly (FD-12 left open rather than changed),
the five API files that touch rooms and dirt: 70/70.
`src/test/migrationNumbers.test.ts` fails on the gap 125-128 until the master
renumbers the migration.

**Left open** - questions for the owner in the master's report: rooms or
bookings for In house; "Vacant" on the property page against "Empty"
everywhere else; the Properties list's "N guests in house" (bookings, for the
close refusal); the night audit's Room Status Occupied/Vacant (a closed day's
own figure, unchanged); FD-9 to FD-12.

---

## 2026-09-21 · The walk-in asks a phone and email; the stay panel's CRM marks

**Asked for:** the CRM chat's phase 1 (`docs/briefs/crm.md`); the whole entry
is `src/modules/crm/CHANGELOG.md`.

**Shipped** - the walk-in: optional phone and email, the returning-guest
suggestion and blacklist warning, the two ticks; the name list under Guest is
gone (the owner, CRM-Q4). `operations.ts` takes them and checks a confirmed
guest above the first write. The stay panel (`flows/GuestMarks.tsx`):
"stayed with the group N times", the WhatsApp tick the desk may change, a
Guest 360 link for owner, admin and GM (`stayExtras.ts` routes).

**Found** - FD-8 (open): the walk-in refused a room Rooms showed Free.

**Proved** - `walkInReturning.test.tsx` (5; all 5 fail on the old form),
`guestMarks.test.tsx` (2); on screen, a walk-in on a returning guest's record
and the tick saved from the panel. Gates in the CRM entry.

**Commits:** branch `crm/phase-1`, `1d62c8d`.

---

## 2026-09-16 · Rooms says when the server does not answer, and FD-2

**Asked for:** the owner, round 1 of the service chats — (1) the `/stay` error
branch (critique P0): an error with a retry, the last good room grid kept on
screen, proved with the API stopped; (2) FD-2. Off-limits: `StayTable.tsx`,
`InHouse.tsx` and every reader of `getFolioBalance`,
`api/src/modules/front-desk/operations.ts`. None was touched (`npm run lane --
front-desk`: all six code files yours, exit 0).

**Shipped** (branch `front-desk/stay-error-branch`, copy `D:\fidato-front-desk`)
- `pages/StayView.tsx` — loading, did-not-load, offline and not-current are
  four different screens now instead of one skeleton (FD-6):
  - loading: a skeleton shaped like the tiles on Rooms and the grid on
    Calendar, under the real heading;
  - nothing ever loaded: `ErrorState` "The rooms did not load" + Try again;
    for an unreachable server "Could not reach the server, and there are no
    rooms from earlier to show in their place.";
  - device offline, nothing loaded: "No connection", no retry — the read
    resumes by itself;
  - a later read fails: the last good house stays, under a strip — "No
    connection — these rooms are as they were at 7:23 PM. The fortnight from
    1 Sep 2026 has not loaded." + Try again.
- FD-2 — `flows/CheckInFlow.tsx`, `flows/WalkInFlow.tsx`, `data/operations.ts`:
  the `"front desk"` literal and the `user` field are gone from check-in and
  the walk-in.
- Tests: `stayViewStates.test.tsx` (2), `actorFromSession.test.ts` (2).
- `DEFECTS.md` — FD-2 and FD-6 fixed; FD-5 and FD-7 found and open.
  `MODULE.md` — open items, guards, the new claim command, and four requests
  under "Requests from this service".

**Found**
- **`placeholderData` would not have kept the grid.** The critique named it;
  React Query uses a placeholder only while a query is pending and drops it
  when the query fails (`query-core/src/queryObserver.ts`). The page records
  the last window that loaded — this hotel, this business date — and reads it
  back from the cache. A lesson for the root MEMORY, passed to the master.
- **A second road to the endless bars:** with the device offline React Query
  pauses the read rather than failing it, so an `isError` branch alone would
  never have fired. Handled.
- **FD-2 was dead data, not a wrong name.** Neither route reads `user`; the
  server takes the person from the session (`app.current_user_id()`). Removed
  rather than replaced with the session's name — which is what the entry
  proposed, so the owner was told.
- **FD-5** — a hotel with no rooms answers `null`, which still draws the
  skeleton forever; its words are the owner's.
- **FD-7** — at 375px, after paging a week, "Today" ends at x=378.
- **Not this service's, passed on:** `PERSISTED` in `App.tsx` names
  `tape-chart`, which matches no query key, so Rooms is not kept for a reload
  offline; finance prints "admin" for a posting with no poster
  (`folios.ts:206`, `billing.ts:98`); the lane setup — `load-demo` needs the
  suite's fixtures first, `migrate.sh --with-dev-identities` ticks green after
  an ERROR, and Vite refuses the Inter font through the linked `node_modules`.

**Proved** — in `D:\fidato-front-desk`, 16 September:
- `npx tsc -b --force` — exit 0.
- `npx vitest run` — 216 passed, 21 files, exit 0 (212 before + 4).
- `cd api; npm test` — 370 passed, 29 files, exit 0.
- `bash db/tests/run.sh` — all 622 assertions passed, exit 0.
- `npm run build` — exit 0, "✓ no test sign-in in dist".
- Each new test seen to fail: the old `StayView.tsx` fails both; with only
  the error branch removed, test 1 fails at "The rooms did not load"; with
  only the kept window removed, test 2 finds no strip; with the literal back,
  the FD-2 guard names `WalkInFlow.tsx:27` and both `user: string` lines.
- In the browser, signed in as Test Reception on `fidato_front_desk`, API on
  8790: loaded (17 tiles) → API stopped → Next week: strip shown, 17 tiles
  kept, names readable → reload: "The rooms did not load" + Try again, no
  skeleton → Try again with requests held 12s: the tile-shaped skeleton, then
  the error again (not stuck) → API started → Try again: 17 tiles, 7 names,
  no strip. At 375×812: strip 105px, Try again 44px, no sideways scroll.
  Console after a clean reload: no React warnings; one 403, the Inter font.

**Left open**
- The owner: FD-2's fix differs from the entry's (removed, not replaced);
  FD-5's empty-hotel words; whether Rooms is kept on the device for an offline
  reload (the `PERSISTED` request).
- Not seen: the strip's red tone for a server that answers with an error
  (rather than not answering). It is built, but neither a test nor the browser
  check reached it — both stopped the server.
- `api/src/modules/front-desk/operations.ts` still declares an unused
  `user?` on the check-in body — off-limits this round.

**Commits:** the commit that adds this entry, on `front-desk/stay-error-branch`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/front-desk/index.ts`, at first mounting
  `stays.ts`, `operations.ts` and `stayExtras.ts` whole from
  `api/src/routes/`.
- Step 4a (`23cd2e4`): the mixed data files cut in place — `operations.ts`
  kept check-in and check-out, walk-ins, room moves and void, and handed
  finance's charges and cash drawer and housekeeping's board to files of
  their own; `stays.ts` handed its folio reads to finance's `folios.ts` and
  its groups to reservations' `groups.ts`.
- Step 4 (`880a5b6`), moved into this folder:
  - pages — `Arrivals.tsx`, `InHouse.tsx`, `StayView.tsx`, `WalkIns.tsx`
    (from `src/pages/`)
  - thirteen flows — `AmendStayFlow`, `AssignRoomFlow`, `CheckInFlow`,
    `ExchangeRoomFlow`, `HouseFloor`, `InclusionsFlow`, `LateCheckOutFlow`,
    `MoveRoomFlow`, `StayActions`, `StayDrawer`, `StayMarks`, `VoidFlow`,
    `WalkInFlow` (from `src/components/flows/`)
  - `components/StayTable.tsx` (from `src/components/lists/`)
  - data — `operations.ts`, `stayExtras.ts`, `stays.ts`, `stayview.ts` and
    `stayview.test.ts` (from `src/data/repositories/`)
  - the door gained what finance, reservations and reports use.
- Step 5, the server: `stays.ts` and `stayExtras.ts` moved to
  `api/src/modules/front-desk/` (`3424882`); `operations.ts` moved and
  handed its money half to finance's `postings.ts` and `cashier.ts`
  (`b772047`).
- Step 7 (`f02c781`): the tape chart's tests moved out of `src/App.test.tsx`
  into `front-desk.test.tsx` in this folder.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- The move had silently narrowed a guard: rule 2b of `repositories.test.ts`
  (no exported data function without a caller) read only
  `src/data/repositories`; it was widened to every data folder and to door
  imports (the `880a5b6` commit; root MEMORY 272 — a project-wide lesson,
  kept in the root file).
- Writing the brief: `flows/WalkInFlow.tsx:27` holds `const USER = "front
  desk"`, a third copy that MEMORY 256 and `HANDOVER.md` § 6 do not name.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in this folder's `front-desk.test.tsx`, 2 in
  reports'); with `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of
  204 (the 4 left in `src/App.test.tsx`, not investigated). This change is
  Markdown only.

**Left open**
- Where `GET /:code/groups` belongs: the split left it in this service's
  `stays.ts` (see `MODULE.md`).
- The `WalkInFlow.tsx` literal above.

**Commits:** `e9dd6b1`, `23cd2e4`, `880a5b6`, `3424882`, `b772047`,
`f02c781`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
