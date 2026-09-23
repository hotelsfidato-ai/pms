# Changelog — Central CRM

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 21 September, phase 1** (`MODULE.md`).

---

## 2026-09-22/23 · CRM-2 and CRM-3 built (the owner's D22-8)

**Asked for:** the owner's D22-8, through the master: "Both" - a "not the
same person" answer on the same-person list (owner, admin, GM; recorded who
and when; undoable, as a join is), and a warning on Arrivals and at check-in
when a booking-site guest matches a blacklisted guest (exact phone or email,
as D21-2/D21-20; suggested, never automatic, never blocking, D21-21).

**Shipped** (branch `crm/crm-2-crm-3`, copy `.claude/worktrees/agent-a0cfb728aea00c59d`)
- Migration "not the same person", written as 128 on the master's word:
  `guest_not_same`, `app.guest_not_same` and its undo (managers only, the
  only way in), `app.same_person_pairs` (same signature) leaving answered
  pairs out and following each record to the one that stands;
  `app.booking_site_blacklist` (INVOKER), the match being
  `app.guest_suggestions`'.
- Routes in `api/src/modules/guests/people.ts`: `POST/GET /crm/not-same`,
  `POST /crm/not-same/:id/undo`, `GET /guests/blacklist-warnings`. The two
  writes mapped in `api/src/roleGate.ts` like the joins.
- Possible same person: a "Not the same person" button on each pair, and a
  "Not the same person" list under "Joined" with who, when and Undo.
- `BookingSiteBlacklist` (guests' front door), placed by one line each in
  front desk's `pages/Arrivals.tsx` and `flows/CheckInFlow.tsx`.
- `channel.ts` is not touched: the warning is read when Arrivals and the
  check-in open, so it also covers a guest blacklisted after the booking came.

**Found**
- Two slips in my own tests, each caught by its first run: the database test
  provisioned its second property after the session had become the clerk's
  ("Only a group administrator may provision a property"), and the API test
  expected an administrator to read a GM's name on the list. The list gives a
  dash there, as the joins list does (MEMORY 283).
- `src/test/migrationNumbers.test.ts` fails in this copy, and only here:
  125-127 are not in it. The master renumbers at merge.

**Proved** (numbers from the final runs, 23 September, on the finished code)
- web `npx tsc -b --force` 0; API `npx tsc --noEmit -p .` 0
- `npx vitest run src/modules/crm src/modules/front-desk src/modules/guests`:
  11 files, 74 tests, exit 0
- `cd api; npm test -- guests crm roleGate`: 4 files, 73 tests, exit 0 (62
  before; `notSamePersonAndBookingSites.test.ts` adds 11)
- `bash db/tests/run.sh`: 973 assertions, 22 in "crm" (14 before), exit 0;
  `bash db/tests/rerun.sh`: "all 125 migrations are re-runnable", exit 0
- Every new test seen to FAIL with the change taken out, then pass:
  - list keeps answered pairs: API "takes the pair off the list", DB "an
    answered pair leaves the list"; no booking-site filter: API and DB "a
    desk booking is not"; route's manager check removed from POST not-same
    (the function's still standing): API "answered only by owner, admin or GM"
  - the inner guards alone, the route checks still standing (MEMORY 318): the
    function's manager check: DB "a clerk cannot say..." and "keeps who gave
    it"; the answer not following a join: DB "follows a record joined";
    `booking_site_blacklist` made SECURITY DEFINER: DB "another hotel's clerk
    is told nothing"
  - no blacklist filter: API 3 CRM-3 tests, DB 1; the undo route's manager
    check removed: API "is undone by a manager"
  - web: no placement in the check-in: "warned of again in the check-in";
    no on-screen filter: the Arrivals and upcoming tests; no Arrivals
    placement: all three; no button: crm "not the same person"
- Not opened in a browser: the brief for this job forbade the browser pane
  and ports 8787/5173. The two front-desk placements are proved through the
  whole app in jsdom (`bookingSiteBlacklist.test.tsx`), not on screen.

**Left open** - the questions in the report to the master (which bookings
count as "from a booking site"; the CRS; a join of a pair answered "not the
same"). Front desk's own notes do not yet mention the two placements.

**Commits:** `91d743c` (code and tests), and the notes commit after it.

---

## 2026-09-21 · Phase 1 built: one guest, one record

**Asked for:** the owner, through the master: "build in the brief's order" -
returning-guest matching (suggested on an exact phone or email, a clerk
confirms, never automatic), the "possible same person" list with undoable
joins, the blacklist as a warning that never blocks, "stayed with the group
before" with no details at the desk, "do not send me offers" against the phone
or email for the whole group, the "guest agreed to WhatsApp" tick on bookings
and walk-ins, and Guest 360 for the owner, admin and GM. Every screen in
"Guests & CRM". Nothing leaves this machine.

**Asked of the owner first** - eleven questions, each with a recommendation,
all answered as recommended (CRM-Q1 … CRM-Q11 in `MODULE.md`, for the master
to copy into the decisions file).

**Shipped** (branch `crm/phase-1`, copy `.claude/worktrees/wonderful-napier-15eaa2`)
- ONE migration, `122_one_guest_one_record.sql` (written as 121; 122 from the master, online check-in merged first): the
  phone and email keys, `guests.joined_into`, `app.is_crm_manager`, the
  visit count, the suggestion and its re-check, `guest_joins` with join and
  undo, the managers' reads (same person, Guest 360, search), one "charged"
  (`app.stay_charged`), `offer_opt_outs`, `reservations.whatsapp_agreed`
- `api/src/modules/guests/people.ts` - every CRM route; mounted from the
  guests door (no change to the master's `server.ts`)
- The booking (`book.ts`, `groups.ts`) and the walk-in (`operations.ts`)
  take the confirmed guest, checked again above the first write, and the
  two ticks; the stay panel's marks and WhatsApp tick (`stayExtras.ts`)
- Screens: Guest 360 and Possible same person (this folder); the suggestion
  and the ticks on New booking and the walk-in; "stayed with the group N
  times", the tick and a Guest 360 link on the stay panel
- The walk-in asks an optional phone and email, and its name list is gone
  (CRM-Q4)

**Found**
- CRM-1, fixed: 013's blacklist trigger refused an ADMINISTRATOR (D21-21
  says admin may) - `is_manager()` does not answer for the admin role
- CRM-2, CRM-3, open, the owner's: no "not the same person" answer on the
  list; a channel booking is never matched or warned
- FD-8, open (front desk): the walk-in refused room 208, shown Free on
  Rooms, because `rooms.occupancy_status` said occupied
- My first ports, 8797 and 5197, were in use by the POS chat at the time, so
  this copy ran on 8811 and 5211 (the master's rule since: 8797 is the CRM's,
  root MEMORY 314)

**Proved** (numbers from the runs on the committed tree)
- On the merged tree (`8512b6d`, cp6 at `b7fc99b` merged in, migrations
  120, 121 check-in, 122 this), each judged by its exit code: web
  `tsc -b --force` 0; API `tsc --noEmit` 0; `npx vitest run` 60 files, 558
  tests, 0; `cd api; npm test` 79 files, 1264 tests, 0; `db/tests/run.sh`
  965 assertions (14 in "crm"), 0; `db/tests/rerun.sh` "all 122 migrations
  are re-runnable", 0; `npm run build` 0, "no test sign-in in dist (6 files
  checked)". Before the merge, on `1d62c8d`: web 538, API 1233, database 965
- Every new guard seen to fail with its fault put back:
  - API, `oneGuestOneRecord.test.ts` (26), five breaks: no conflict check -
    2 fail; the browser's guest id trusted - 1; an undo that leaves the stays
    - 1; the ID rule removed - 4; the managers-only route check removed - 7
  - web, `walkInReturning.test.tsx`, the old walk-in form put back: all 5 fail
- On screen, in this copy (API 8811, web 5211): as Reception, New booking
  with a demo guest's phone typed "098425 39757" showed "Tanvi Singh [DH] ·
  Stayed with the group once - same person?"; "Same person" and the tick
  booked FH-5EL-2609-5031 on her record (no new guest; `whatsapp_agreed`
  true). As the GM: Guest 360 found her by "+91 98425 39757", showed both
  stays; blacklisted her with a reason. As Reception: the walk-in showed the
  warning with the reason and the suggestion, and took FH-5EL-2609-5032 on
  her record; the stay panel said "Stayed with the group once" and its tick
  saved (audit log: false -> true, with the actor). Reception was refused
  Guest 360. As the GM: "Possible same person" listed her and a second
  record; Join moved one stay; Undo put it back (database checked both ways)

**Left open**
- The owner's: CRM-2, CRM-3
- The master's (MODULE.md, Requests): `navigation.test.ts` (edited here),
  marketing's gate, the decisions file, where the routes live
- The leads app's conversations: a link when that app is connected (D21-5)

**Commits:** `1d62c8d` (the work), `8512b6d` (cp6 merged in), and the one
carrying this entry.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/crm`, guarded), `pages/Crm.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
