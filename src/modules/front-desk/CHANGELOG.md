# Front desk — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

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
