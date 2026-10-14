# Defects — the front desk

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `FD-1`, `FD-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### FD-26 · A price saved on Rates did not reach the Calendar until something else refreshed it - FIXED 4 October (Rates refreshes the Calendar)

**Found** - 4 October, opening the Calendar after setting a night's price on
Rates (D27-271 item 3): the Calendar still showed the old figure. Its window
(`stay-view`) is kept with `staleTime: Infinity` and persisted, and Rates'
`refresh()` invalidates only its own reads. It was so for the old rack rate
too. **The fix** is one line in inventory's `pages/Rates.tsx` `refresh()`:
`qc.invalidateQueries({ queryKey: ["stay-view", hotelId] })`. Not made here:
the file is inventory's (on `MODULE.md`'s Requests).

---

## Fixed — the solution is here; do not work it out again

### FD-32 · A voided booking that held a room was drawn on the Calendar as a confirmed one, and took a free room off its type's count - FIXED 14 October (the owner's D27-323 (1))

**Found** - 14 October, D27-319 (1), naming the Calendar's seven bar colours.
`toneFor` (`data/stayview.ts`) gave the struck-through colour to status
`cancelled` only. A VOIDED booking arrives as status `void` (stays.ts:
`row.status.replace("_", "-")`; `void` is not in `StayStatus`, so the type
cannot catch it), fell through to "confirmed", and keeps the room it was
given (the board's room join keeps a released hold for every status but
confirmed, so a cancelled or voided booking still sits on its room). So it
was a pale blue Confirmed bar on that room, and the room type row's free
count for those nights was one low.
**The root** - the Calendar counts its free rooms itself, in the web app: the
room type row and the footer (`getStayView`) and the floor row
(`StayView.tsx`) each count every room with a bar NOT of the struck-through
tone. All three read `toneFor`, so the one wrong line there was both the
wrong colour and the wrong count. The server and the database were already
right: voiding releases the room (`app.void_releases_rooms`, 042/073) and
`app.inventory_grid` leaves out `void` - New booking, the channel manager's
ARI and inbound, and Rates read that.
**Fixed** - `toneFor` gives `void` the struck-through tone too; the key and
the stay panel's pill (both `BAR_LABEL`) read "Cancelled or void".
**Proved** - `data/stayview.test.ts` "a voided booking (FD-32)" and
`calendarKey.test.tsx`, seen failing on the old code (the bar "confirmed",
the type's free count 2 not 3, the footer 9 not 10, the key "Cancelled"),
passing after. On screen (scratch `fidato_fd32`, 5EL, Calendar, General
Manager): FH-2608-5020, room 307, 14-17 Oct, Deluxe free 6/6/6 on 14-16 Oct;
voided ("Entered twice") - the bar struck through, pale red, Deluxe 7/7/7,
Floor 3 7/7/7, Available 15/16/17 (was 14/15/16), `app.inventory_grid` 7/7/7.
**Still letting a void through (a list count, not a free room; not changed -
the owner's to say):** the desk's arrivals filter on `!== "cancelled"` too:
Arrivals Today (`listArrivals`), Upcoming (`Arrivals.tsx`) and the
Dashboard's Arrivals tile. Seen: Upcoming listed the voided FH-2608-5020 with
a "Void" pill and counted it in "15 expected".
**The rule** - a status the API sends and `StayStatus` does not name passes
every `!== "cancelled"`. Ask which statuses a filter must let through, not
which one it must keep out.

### FD-31 · Rooms, the Calendar and the Dashboard read every booking ever made, two or three times each - FIXED 14 October (D27-316 (1))

**Found** - FD-27 left it open: the board (`getStayView`) read every booking
for its bars and again inside finance's `listOpenFolios` for the bars'
balances; Rooms read it a third time for the names under its tiles; the
Dashboard read it for today's work beside its one-day board. 793 rows and
~3 s each on the 13 October copy: Rooms' data 10-15 s, the Calendar's 8-9 s,
the Dashboard's 12 s, on a loaded PC.
**Fixed** - `GET /:code/stays?from&to&board=1`: every booking with a day in the
window, whoever is checked in, and the bookings still to arrive that hold a
room (a tile's Arriving and Reserved are about any later date). The board
reads it once and hands it to `listOpenFolios`; Rooms' names read the desk's
day; the Dashboard the day's board. 0.3-0.6 s each. Comparing every fortnight
from May to December, a week either side of today and the Dashboard's day,
the board drew the same from both reads - except the order of two bookings of
one room arriving on one day, which Postgres gave in whatever order the plan
chose; the read now ends its order with the booking's id.
**Also found** - the first version asked "holds a room" of the room join
(`rm.number is not null`), which can only be tried after the join, on every
booking, under row security: 2.7 s for 35 rows. Asked of the booking's own
assignments (`exists`), the filter runs before the joins: 0.13 s.
**The rule:** a screen that shows dates reads those dates. A condition in the
stays read goes on the booking, not on a join, or it costs the whole history.

### FD-27 · Every desk list read every booking ever made, and the Check in button waited for it - FIXED 13 October (D27-313 (1))

**Found** - 13 October, the day check (D27-300): `GET /:code/stays` sent all
793 bookings on the demo in ~3.5 s, and Arrivals, In house, Due out and the
check-in's room list (`assignableRooms`) each read it - In house twice, once
per list. The Check in button stayed grey ~3.5 s on every open, waiting for
the room list, and every payment's refresh read it again. `data/stays.ts`
had said "eighty-three rows is not a dataset worth three endpoints"; it grew.
**Fixed** - the same endpoint takes `from` (and `to`): only the bookings
checked in now and those arriving from..to, each row exactly as the full list
has it. `listArrivals`, `listInHouse`, `listDepartures`, `assignableRooms`
(through `listInHouse`) and Arrivals' Upcoming ask for it and still filter as
before. 18 rows and ~0.1 s on the same demo. Every other reader still gets
every booking. Proved by `api/test/modules/front-desk/deskStays.test.ts` and
`deskRead.test.ts`.
**The rule:** a list that shows a day reads that day from the server, not the
hotel's whole history.

### FD-29 · A late departure was charged again at every Check out after the guest paid - FIXED 13 October (D27-314 (1))

**Found** - 13 October, by the A1/A3/A5 script writer reading the code; the
owner asked for it reproduced first. **Reproduced** on a scratch copy of the
demo (`fidato_d314`, from `fidato-before-day-check-13oct.dump`, a ₹1,000 late
fee set on 5EL), as Reception, in the app's own pane: Kapil Ganjoo, room 206,
nothing owed. Check out → "Leaving after check-out time" → "Late flight,
first time" → Late check-out ₹1,000 + GST ₹50 posted, "₹1,050 is still
outstanding". Settle ₹1,050 cash → Settled ₹0. Check out again → the same
dialog, empty → "Late flight, second time" → a SECOND Late check-out ₹1,000 +
₹50, ₹1,050 owed again, the first reason overwritten. It loops: every payment
and Check out adds another. The route asked `app.departure_is_late` and never
looked at `late_checkout_at`.
**Fixed** - the check-out route (`operations.ts`) asks the rule AND
`late_checkout_at is null`, read after the stay's row lock: a late departure
already recorded (reason, charge or waiver) is not asked again and not
charged again, whatever the body sends.
**Proved** - `api/test/modules/front-desk/lateDeparture.test.ts`, "(1)": the
second check-out (no reason, as the screen sends) is not asked, checks out,
one late line, the first reason kept; a reason sent again changes nothing.
**Rule** - a charge that is posted before a refusal will be posted again on
the retry unless the route remembers it posted it (MEMORY 243's other half).

### FD-30 · A guest leaving a day early was asked "Leaving after check-out time" and charged the late fee - FIXED 13 October (D27-314 (2), migration "late departure on the day")

**Found** - 13 October, the A5 script: a guest leaving early (departure date
after the business date), bill settled, Check out after 11:00 opened the late
dialog. `app.departure_is_late` (063) compared only the hour, on any day.
**Fixed** - the one rule, `app.departure_is_late(hotel, at, departure)`: the
hotel's business date on or after the departure date AND the hour, on the
property's clock, past check-out time. The two-argument version is dropped.
The screens have no rule of their own (the Bill tab opens the dialog only on
the route's `needs`; `src/lib/rules.ts` has no late rule).
**Proved** - `db/tests/modules/front-desk.sql` "late departure" (before,
on, after the date; the business date, not the clock's; one version left)
and `lateDeparture.test.ts` "(2)". `nightAudit.test.ts`'s late fixtures now
leave on the business date (they left the next day, an early departure).
**Rule** - "late" is a date and an hour; the date is the business date.

### FD-25 · With the wifi up and the line down, In house lost its rows to the read's error - FIXED 4 October (D27-271)

**Found** - 4 October, building the owner's D27-271 (4): "offline, In house
and Due out keep guests' balances". With the browser offline the re-check of
the balances PAUSES and the rows stay. With the browser online and the server
unreachable (the commonest hotel failure, `offline.ts`) the re-check FAILS,
and `StayTable` hands the error to `DataTable`, which draws it in place of the
rows: the list the desk needed was gone.
**Fixed** - `pages/InHouse.tsx`: while `isOnline()` is false and the list has
loaded, the error is not passed on; the rows stay, and "Balances as of 4:36 PM,
may be out of date." says how old they are.
**Proved** - `menuWordsOfflineBalances.test.tsx`, "stay on screen when a read
fails for want of the server": fails with `error={active.error}` put back.
**Rule** - offline is `isOnline()`, not `navigator.onLine`; a screen that keeps
its last load has to be tried with the line down, not only with the browser off.

### FD-10 · A room nobody entered is dirtied when its advance booking lets it go - FIXED 2 October (D27-239, migration 185)

**Found** - 22 September, the same reading. 074 leaves a room clean when a
booking ends void, no-show or cancelled, and dirties it for every other
status - so taking a CONFIRMED booking out of the room it was given in
advance (unassign), or checking that booking into a different room, sends the
first room to the cleaning queue with nobody ever in it. Not fixed: 074's
list is housekeeping's.

**Still so, 25 September.** 129 (the one in-house rule) rewrote
`app.vacated_room_is_dirty` and kept 074's list exactly: a release dirties the
room unless the booking is void, no-show or cancelled - so a CONFIRMED
booking's advance room is still dirtied. 130 asks the right question
(`r.status = 'checked_in'`, citing FD-10) but only for a guest moved mid-stay
(FD-9), not for a release.

**The fix, when it is done** - dirty only when the stay had arrived
(`checked_in` or `checked_out`), which is 074's own question, "did anybody
actually go in?".

**Fixed, 2 October** (the owner's D27-239 8.3). Migration 185 replaces
`app.vacated_room_is_dirty`: a released room is dirtied only when the stay had
arrived (`checked_in` or `checked_out`). Check-in now lets go of the stay's
other advance room BEFORE it marks the stay checked in, so that release is
still a booking that never arrived. Proved: `api/test/modules/front-desk/roomCleaning.test.ts`
(hotel FCL) "when a booking given it ahead lets it go" and "when the guest is
checked into another room" - both fail on the old trigger.

### FD-12 · A room checked out of stays clean while a later booking holds it - FIXED 2 October (D27-239, migration 185)

**Found** - 22 September, the same reading. 070's trigger dirties a released
room only if no OTHER live assignment holds it ("somebody else may already be
in it") - and a room given in advance to next week's booking is held, so the
room a guest has just left is not sent for cleaning. The same confusion as
FD-8 (held is not in), in housekeeping's rule. Kept exactly as it was: what
reaches the cleaning queue is housekeeping's and the owner's.

**Still so, 25 September.** 129 rewrote the function and kept the "any other
live assignment" guard; its own comment names this defect ("keeps clean a room
checked out of while a LATER booking holds it - FD-12, left for housekeeping
and the owner"). 130 and 137 already ask `app.in_house` instead - for a room
moved out of, not for a check-out.

**The fix, when it is done** - ask whether anybody is IN the room
(`app.in_house`, or the column now set from it) instead of whether it is held.

**Fixed, 2 October** (the owner's D27-239 8.3). Migration 185: the room is left
alone only while somebody ELSE is in it (`app.in_house`), never because a later
booking holds it. Proved: `roomCleaning.test.ts` "is sent to cleaning at
check-out" (fails on the old trigger).

### FD-24 · A check-in that moved the arrival left the room hold on the old dates - FIXED 30 September (D27-205, numbered for now)

**Found** - 30 September, planning D27-204: the first night's line reads the
room held tonight, and for `FH-2608-4867` (booked from 2 October, checked in
on 30 September) there was none. The booking said 30 Sep - 5 Oct; the live
hold said 2 Oct - 5 Oct.

**What was wrong** - `POST /:code/stays/:id/check-in`
(`api/src/modules/front-desk/operations.ts`) moves `reservations.check_in` to
today for an early arrival, but asked the room's clash about the booking's OLD
dates and wrote the hold (`room_assignments`) on them. The nights the guest
moved onto were neither checked nor held: somebody else could already hold the
room tonight, the room could be sold again tomorrow, and the night audit's
line read "Room - · 1 night".

**The fix** - one `arrival` (today when the arrival moves, else the booking's)
for the clash check and the hold; a hold given ahead on the same room is
stretched back to it (`update room_assignments set from_date`), since the
insert would otherwise meet its own exclusion and do nothing.

**Proved** - `api/test/modules/front-desk/firstNight.test.ts`, "FD-24": the
hold starts today and the first night names the room; a room somebody else
holds on a moved-onto night is refused by name. Both fail on the old code
(held from 2026-08-31; 200 for 409).

### FD-23 · A check-in with the ID block's default "IN" took a returning foreign guest off the Form III register - FIXED 30 September (D27-197, numbered for now)

**Found** - 30 September, moving the walk-in route's tests onto the booking
plus the check-in (the route went, Rule 2b). The one page's ID block opens on
"IN" and does not read a returning guest's record. The check-in took the
nationality typed over the one on file, so Form III was not asked, and it then
wrote `guests.nationality = 'IN'`. The walk-in route had the guard; the
check-in never did, from Arrivals either. On a guest on file as GB: expected
409 and GB, got 200 and IN.
**Fixed** - the owner's D27-197: at check-in, "IN" typed never replaces a
foreign nationality on file (`operations.ts`, the check-in); Form III is asked
of the nationality on file. `api/test/modules/guests/formIII.test.ts`, "keeps
a returning foreign guest foreign when the form says IN", seen failing first.
**Rule:** a rule that lives in one route is lost when that route goes. Before
removing a route, list what it refuses and find each refusal on the path that
replaces it.

### FD-21 · A bad stay id on a stay's inclusions answered 500 - FIXED 30 September (numbered for now)

`GET/POST/DELETE /:code/stays/:id/inclusions` passed the id to Postgres unchecked; a non-uuid failed the cast. **Fixed:** one middleware answers 404 "No such stay." first (`stayExtras.ts`, `api/test/modules/front-desk/badStayId.test.ts`).

### FD-22 · A check-in could move a booking weeks earlier with nobody seeing it - FIXED 30 September (D27-193, numbered for now)

The owner's 1 October booking, checked in on a hotel still on 25 August, became 39 nights: early-by-days moved the arrival with any reason. **Fixed:** more than a day early, the check-in first shows the move and the stay's new cost (GST a night as the audit rounds it) with Cancel and Confirm; the server refuses without `confirmMove: true`, before any write (`dayAndRoom.test.ts`, `earlyCheckIn.test.tsx`).

### FD-20 · The check-in's room tiles cut their pill on a phone — FIXED 29 September

**Found** - 29 September, opening the one-page check-in at 390 px (D27-163):
two tiles across left each about 159 px, and six of eight rooms'
housekeeping pill ("inspected", "out-of-service") ran out of its tile. The
five-step dialog had the same grid, so it was there before.
**Fixed** - one column below the `sm` breakpoint (`flows/CheckInFlow.tsx`);
measured again at 390 px, none overflow (7c0373e).
**Rule:** measure a grid of tiles at 390 px with the longest word it can hold.

### FD-19 · The QA's front-desk wrong results of 28 September - FIXED 28 September (QA FD-1..FD-9)

The walk-in skipped the ID step for an Indian guest (QA FD-1); an Aadhaar "12ab"
was taken and the whole number shown on the summary (FD-2, FD-3); children -1,
-2 or 400 nights, a cleared date, adults 0 went through or hit a database
constraint (FD-4, FD-6, FD-8, FD-9); phone "abc" (FD-7); a checked-out stay
showed the room given ahead (FD-5: both assignments released on one date, a tie
- migration 154 orders by the release). The check-in's ID checks now sit below
the room checks, so an occupied room is refused for the room. The rules are
api/src/validate.ts's. Tests: deskChecks.test.ts, dayAndRoom.test.ts,
checkInChecks.test.tsx, walkInReturning.test.tsx.

### FD-7 · On a phone, after paging a week, "Today" ends past the screen's edge - FIXED 17 September, held by a test 26 September

**Found** — 16 September, measuring FD-6's strip at 375×812. Not caused by it.

Once the window is moved off the business date the controls row gains a
**Today** button, and at 375px that row ends at x=378 — three pixels outside
the viewport. The page does not scroll sideways; the button's right edge is
simply cut. Part of the critique's P3 (`/stay` spends its first 600px on
controls), which is not in round 1.

**The fix, when it is done** — with P3, when the controls are laid out again.

**Changed 17 September, not yet proved** — the owner's D17-41, commit
`f7ae0f4`: the week controls' row wraps (`flex flex-wrap`, marked `FD-7` in
`pages/StayView.tsx`), so Today drops to a second line instead of past the
edge.

**Held by a test, 26 September (D25-27)** — `front-desk.test.tsx`, "puts
Today, once a week is paged, in a row that wraps (FD-7)": the Calendar, Next
week, and the row holding Today carries `flex-wrap` (jsdom has no layout, so
the class, as `Input.test.tsx` holds the kit's touch sizes). Seen failing with
the class taken out: `expected [ 'flex', 'items-center', 'gap-1' ] to include
'flex-wrap'`. Not measured at 375px in a browser this time; the class is what
is held.

**The rule** — MEMORY 167's, again: measure a control's right edge at phone
width in every state it has, not only the first one.

### FD-18 · A Rooms tile said "Due out" over the arriving guest's name - FIXED 24 September

**Found** - 24 September, fixing FD-17. The Rooms board names a tile's
guest from a map of today's stays, one per room, and a booking arriving
today counts as "live" there. A room whose guest leaves today and that is
given ahead to today's arrival (allowed, D24-26) held both; the list is
ordered by arrival, so the arrival came last and its name replaced the
guest's: tile 204 read "Due out, Lata Bhosale" while Ganesh Patil was in
it - the look the owner saw, which FD-17 alone did not explain.

**Fixed** (the owner, 24 September: "name the guest in the room") -
`pages/StayView.tsx`: an arrival never replaces a guest already named for
that room.

**Proved** - `refusedControls.test.tsx`, "names the guest in the room, not
the arrival it is held for": on the old screen "expected 'Lata Bhosale' to
be 'Ganesh Patil'". On screen with Lata still held for 204:
`.local/screenshots/2026-09-24-polish/11-tile-204-*`.

### FD-17 · A booking taken out of its room still showed that room - FIXED 24 September

**Found** - 24 September, on the Rooms board while taking the follow-ups'
screenshots. Lata Bhosale (FH-2608-5005, arriving the 25th) was given 204 in
advance; "Take them out of the room" released it. `GET /stays/:id` still
answered `roomNumber: "204"`. `stays.ts` takes one assignment per stay,
"preferring the one still held and then the most recent" - released ones
included, on purpose, so a departed stay keeps its room on folios and
invoices. The Calendar's bars and the Rooms tiles are built from the same
list.

**Fixed** - in the one query every screen reads (`SELECT` in
`api/src/modules/front-desk/stays.ts`): a released assignment counts for
every status except `confirmed`. A booking still to arrive holds only the
room it holds; checked-out, no-show, cancelled and void stays keep the room
they had, exactly as before (narrower than the fix first written here,
which would have taken a void's bar off the Calendar).

**Proved** - `api/test/modules/front-desk/dayAndRoom.test.ts`, "FD-17": a
booking assigned 104 and taken out answers `""` from the stay and from the
list; on the old query "expected '104' to be ''". "keeps a departed guest's
room": every checked-out 5EL stay still has one (passes before and after).
On screen after taking Lata out of 204: tile 204 names Ganesh Patil, and
Arrivals shows Lata with no room
(`.local/screenshots/2026-09-24-polish/12-*`, `13-*`).

**Left** - an unassigned booking cannot be opened from a Rooms or Calendar
link (`?res=`): the panel looks for its bar, and a booking with no room has
none. Open it from Arrivals. As before; not changed.

### FD-16 · Check-in and the swap fell back to a business date that never moves - FIXED 24 September

**Found** - 24 September, reading the routes for rule A. `POST
/:code/stays/:id/check-in` and `POST /:code/stays/:id/exchange` used the
caller's date, else `select business_date from hotels` - the column 023
calls "the day this property is operating in, when no night audit has run
yet". Nothing advances it: `app.business_date` is the day after the last
COMPLETED audit. The screens send their own date, so only a call without
one was behind. The same read was in `GET /:code/groups`' "current" list,
so a group whose last guest left on a closed day still counted as current.

**Fixed** - `resolveDate` in the check-in, `businessDateFor` in the swap,
`app.business_date($1)` in the groups list.

**Proved** - `dayAndRoom.test.ts`, "FD-16" (3), at a property with the 25th
closed (column 25th, day 26th): on the old routes the check-in answered
"This booking arrives on 2026-08-26, not today...", the swap "both guests
have to be in a room on that date", and the group was listed. Other
modules still reading the column (channel manager's ARI, `pos/till.ts`)
were told to the master, not changed.

### FD-15 · The check-in screen never sent the early-arrival reason - FIXED 24 September

**Found** - 24 September, opening the check-in screen to show FD-11's
refusal. Lata Bhosale (FH-2608-5005) at 12:50, before 5 Elements' 14:00: the
Rate step asked "Why the room is being given early", the reason was typed,
Continue was allowed - and the server answered "Rooms are ready from 14:00.
An early arrival needs a reason and somebody to allow it." The screen kept
`earlyReason` and `waiveEarly` in its state and never put either in the call;
`data/operations.ts` accepted both all along. Present since the first
early-arrival commit (`f44f93b`, 4 September), so **every check-in from the
screen before a property's check-in hour was refused**. No test drove the
flow as far as the call.

**Fixed** (the owner, 24 September: "Fix both now") - `flows/CheckInFlow.tsx`
sends `earlyReason, waiveEarly`. The waive tick is drawn only for somebody
who may waive, and the server asks again (FD-14).

**Proved** - `earlyCheckIn.test.tsx` (2): a clerk's reason goes with the
check-in and no waive; a manager's waive goes with the reason. Both failed
first (neither field in what was sent). On screen at 13:16, before 14:00:
Lata Bhosale checked into 209, the booking recording "Overnight train" under
Test Reception
(`.local/screenshots/2026-09-24-front-desk/10-early-check-in-with-reason-desktop.png`).

**The rule** - a field a screen asks for is proved by what the button SENDS,
not by the box being on the screen.

### FD-14 · A check-in refused for waiving the early charge was still a check-in - FIXED 24 September

**Found** - 23 September, reading the check-in route for FD-11. The refusal
"Setting that charge aside is a manager's decision..." (`WAIVE_REFUSED`, for
`waiveEarly` from somebody `mayWaive` says no to) sat BELOW `update
reservations set status = 'checked_in'`, the folio, the moved arrival date
and the early-arrival record, and `withSession` commits a refusal (MEMORY
243): the clerk was told no while the guest was checked in, with no early
charge.

**Fixed** (the owner, 24 September) - in `POST /:code/stays/:id/check-in`
the question is asked beside the other refusals, above the first write, as
check-out's twin already was; the check below the writes is gone.

**Proved** - `api/test/modules/front-desk/inHouseRule.test.ts`, "FD-14 · a
clerk's waive of the early charge is refused before anything is written": a
front-desk clerk sends `waiveEarly: true` with a reason for a booking
arriving tomorrow - 409, the sentence, and the booking still `confirmed` on
its own date with no early record. Before the fix it failed (`status:
'checked_in'`), and room 103 then counted in house, failing the three counts
too. By hand on this copy: reception's waive for FH-2608-5005 refused, the
booking still `confirmed`.

**Left** - the screen offers the waive to whoever holds `reservation:
approve` (owner, admin, GM); the server's `mayWaive` is a group administrator
or an owner or GM at the hotel. So a hotel-level administrator (D23-2) sees
the tick and is refused, in words, before anything is written - the same as
the late check-out's tick. Found by reading; not run. Who may waive is the
owner's, and was not changed.

**Early tick finished 24 September** (the owner's D24-16) - `GET
/:code/early-arrival` answers `mayWaive`, the server's own `mayWaive` asked
for the person calling, and the check-in screen draws the tick from it
instead of `can(role, "approve", "reservation")`. Proved -
`earlyCheckIn.test.tsx`, "offers no waive to a hotel administrator the
server would refuse" (fails on the old screen: "expected <input> to be
null"); `inHouseRule.test.ts`, the answer is false for a clerk and true for
the owner (fails on the old route: "expected undefined to be false"). On
screen, before 5EL's check-in hour: a hotel-level administrator sees the
reason and no tick; the owner sees both
(`.local/screenshots/2026-09-24-follow-ups/03-*`). **Late tick finished
24 September** (D24-27): `flows/LateCheckOutFlow.tsx` draws its tick from
the same `mayWaive` answer; `refusedControls.test.tsx`, "offers no waive to
a hotel administrator the server would refuse", fails on the old dialog.

### FD-11 · A check-in did not ask whether somebody was still in the room - FIXED 23 September

**Found** - 22 September, fixing FD-8. The walk-in refused a room a
late-checkout guest was still in; the check-in of a booking asked only
whether another booking's NIGHTS overlap, and a guest past their departure
date holds no night that overlaps anybody's. The room picker offers the room
the booking was given in advance whoever is in it, so the desk could check an
arrival into a room whose guest had not left. The demo has two: 201
(FH-2608-4858 checked in over FH-2608-4857) and 204 (FH-2608-5005, Lata
Bhosale, arriving on the 25th into 204 while Ganesh Patil, FH-2608-5004, due
out that day, has not checked out).

**Fixed** (the owner's D23-12) - in the one route every check-in passes,
`POST /:code/stays/:id/check-in` (`api/src/modules/front-desk/operations.ts`):
before the clash check and above the first write (MEMORY 243), it asks
`app.in_house` (129, the one rule) whether anybody is in the room now, and
refuses by name: "Ganesh Patil (FH-2608-5004) is still in room 204. Check
them out first, or choose another room." The check-in screen shows it the way
it shows every refusal, as the "Could not check in" toast. No screen change;
no new route.

**Proved** - `api/test/modules/front-desk/inHouseRule.test.ts`, "and the
check-in of the booking held for that room refuses it, naming who is in it":
FDW-HELD (arriving on the 27th, given 101 in advance) into 101 while the
walk-in due out on the 26th is still checked in - 409, the sentence above
with the walk-in's name and reference, and the booking still `confirmed`
afterwards. With the guard switched off it fails, and the check-in goes
through: 1 of the file's 8 fails, "expected 200 to be 409". On screen:
`.local/screenshots/2026-09-23-fd11/04-check-in-refused-guest-still-in-room.png`.
Again on 24 September in the merged copy: the guard off, the test fails
("expected 200 to be 409"); on, it passes. On screen, through the check-in
screen once FD-15 let an early check-in reach the server: "Ganesh Patil
(FH-2608-5004) is still in room 204. Check them out first, or choose another
room." (`.local/screenshots/2026-09-24-front-desk/04-check-in-refused-*.png`).

**The rule** - "is the room free" is two questions: does another booking hold
these nights (the clash check), and is somebody in it now (`app.in_house`).

**Everywhere a guest goes in, 24 September** (the owner's D24-15, and their
answer in the follow-ups chat: "only when they go in now") - one helper,
`stillIn` in `operations.ts`, gives FD-11's sentence and is asked by the
check-in, the walk-in (which said "Somebody is already in that room." and
now names them), a move from tonight or earlier of a checked-in guest, a
swap from tonight (either guest, not counting the two), and a room for a
guest already checked in - each above its first write. A room given ahead
to a booking not yet here, or a move for a later night, is a hold and is
allowed: its check-in asks on the day. Proved - `inHouseRule.test.ts`
"rule A" (4) and the walk-in's own; on the old routes 6 of 14 fail (the
walk-in's sentence, the move, the swap and the assign "expected 200 to be
409" or a different sentence; the last because the old move went through
and took the room). On screen: "Ganesh Patil (FH-2608-5004) is still in
room 204. Check them out first, or choose another room." as "Not moved"
and as the walk-in's "Could not check in"
(`.local/screenshots/2026-09-24-follow-ups/01-*`, `02-*`).

### FD-9 · A guest moved mid-stay left the old room clean for the next guest - FIXED 23 September

**Found** - 22 September, fixing FD-8, reading 054 against 070. `app.move_room`
SHORTENS the old room's assignment when the guest has slept in it, and
070/074's trigger dirties a room only on a RELEASE, so the room left behind
stayed clean - the very case 070's header names.

**Fixed** (the owner's D23-12) - `db/migrations/130_moved_out_room_is_dirty.sql`
(numbered 130 on this branch; the master renumbers at merge): a new trigger on
the INSERT of an assignment, `app.moved_out_room_is_dirty()`, because only
once the new room is written does `app.in_house` stop putting the guest in
the old one. It dirties another room the same stay holds when that assignment
was cut short where the new one starts (a move or an exchange - not an amended
departure), on or before the business date, the stay is checked in, the room
is clean or inspected, and nobody is in it by `app.in_house`. Every move and
exchange passes through it; no earlier function was changed.

**Proved** - `db/tests/modules/front-desk.sql`, "moved-out room" (6): a guest
moved out tonight leaves 201 dirty and 202 as it was; a move dated tomorrow
leaves tonight's room clean; an exchange dirties neither room (a guest is in
both); a booking that never arrived, moved, leaves its room clean. With the
trigger dropped (in a transaction, rolled back) the first fails - "got clean"
- and the other five pass. Again on 24 September, the whole database suite
with the trigger left out of the migration: "moved-out room" 5 passed, 1
failed, "got clean".

**Left** - a move dated in the FUTURE is not dirtied when the business date
reaches it: no write happens then (the same ceiling 129 names for the
occupancy column; a `ponytail:` note in the migration says where to add it).

**Finished 24 September** (the owner's D24-15) - `db/migrations/
137_future_move_room_is_dirty.sql` (137 on this branch; cp6 took 134-136): the
business date moves in one place, a night audit run becoming `completed`, so
a trigger there asks 130's question for the whole hotel on the new date - a
room a checked-in stay's assignment ends in, where another of its
assignments starts, clean or inspected, nobody in it by `app.in_house`. A
run already completed being corrected fires nothing. Proved -
`db/tests/modules/front-desk.sql`, "moved-out room" 9/9: a run still running
dirties nothing; completing the 25th dirties 203 (moved out from the 26th);
204-208 stay clean. With the trigger left out of the migration: 8 passed, 1
failed, "a move dated tomorrow dirties the old room when the day closes |
got clean".

### FD-13 · On the Calendar, every room with a booking was two rows tall - FIXED 23 September

**Found** - 22 September, by the master chat: each `BookingBar` set
`gridRow: 1` and the empty day cells set only `gridColumn`, so grid
auto-placement put every cell whose column a bar held - and every cell after
it - into a second row. Each of those cells is a "Book room N on date"
button, so a click under a booking started a new one for a night already sold.

**Fixed** (the owner's D23-13) - `gridRow: 1` on the empty cells in
`pages/StayView.tsx`, like the bars. The bars come later in the DOM and sit on
top (`z-10`), so a click on a booked night opens that booking.

**Proved** - `front-desk.test.tsx`, "keeps a room with a booking one row
tall: every empty cell is on the bar's row": the first room with a bar has 14
"Book room" cells, each on grid row 1. Without the fix it fails (14 cells,
grid-row empty). On screen, every room row on the Calendar measures 37px, with
and without bars (`.local/screenshots/2026-09-23-fd11/03-calendar-one-row-per-room.png`).
Again on 24 September in the merged copy: without the fix the test fails,
and every one of 5 Elements' 17 room rows measures 37px with it, a bar's
centre landing on the bar, not a "Book room" cell
(`.local/screenshots/2026-09-24-front-desk/03-calendar-one-row-per-room-*.png`).

**The rule** - in a grid where some children are placed by row and column,
place all of them, or auto-placement will find them a row of their own.

---

### FD-8 · The walk-in refused a room the board showed Free - FIXED 22 September

**Found** - 21 September, the CRM chat: room 208 at 5 Elements showed Free on
Rooms and the walk-in into it was refused "Somebody is already in that room".

**The cause** - two definitions of "somebody is in the room". The walk-in read
the column `rooms.occupancy_status`; the board read the stays. 070's trigger
set the column `occupied` on the INSERT of any live assignment, so a room
given in advance to a booking arriving later was "occupied" from the moment
the clerk chose it, with nobody in it. The demo shows it twice: 208 (held for
FH-2608-4870, 27 to 30 August) and 307 (FH-2608-5020, 30 August on), both
`occupied` on 25 August. A room a guest moved out of mid-stay was the same:
054 shortens that assignment rather than releasing it, and 070 only reset the
column on a release. Real use, not only the demo loader: every "Assign room"
on a future booking did it.

**Fixed** - one rule, in the database (the one in-house rule migration, 129
on this branch): `app.in_house` - checked in and not checked out, in the room
`app.room_for` gives on the business date (D21-36) - and `app.house_now` for
every room (D21-37). The walk-in asks `app.in_house`; the column is set from
it and nothing else, by 070's two triggers (same names, new bodies) and one on
a stay's status, and corrected once for every room. The check-in and walk-in
no longer write the column. A walk-in into nights another booking holds is
still refused - by the clash check, which names the booking.

**Proved** - `api/test/modules/front-desk/inHouseRule.test.ts` (7): a room
given in advance to a booking arriving on the 27th is Empty and `vacant`; a
one-night walk-in on the 25th is taken; a two-night one is refused "held by
FDW-SOON"; two days on the walk-in guest, not checked out, is still in house
and the walk-in refuses their room. With the change taken out, 6 of 7 fail -
the first three on exactly "Somebody is already in that room." -
`db/tests/modules/front-desk.sql` (16; 5 fail with the triggers put back).
Every screen: `inHouseRule.test.tsx` (6; with the screens' own counting put
back, all 5 screen tests fail - 7, 7, 8 rows, 11, 7 where the rule says 2).

**The rule** - a room HELD is not a room somebody is IN. Ask the one rule;
never a column that a second writer keeps.

---

### FD-5 · Rooms and Calendar show the skeleton forever for a hotel with no rooms — FIXED 17 September

**Found** — 16 September, reading `StayView.tsx` while fixing FD-6. **Not yet
seen on screen**: no property a test sign-in can open has zero rooms.

`getStayView` answers `null` — successfully — when a hotel has no rooms
(`data/stayview.ts`, `if (allRooms.length === 0) return null`). The screen's
old `!data` test read that as "still loading". FD-6 deliberately left this
case drawing the skeleton it always drew, because what an empty hotel should
say instead is a sentence a person reads.

**The fix, when it is done** — an empty state (what belongs here, and where
rooms are added), in the words the owner approves. Housekeeping's is "No rooms
set up yet".

**Fixed** — 17 September, the owner's words (D17-23), commit `f7ae0f4`:
`data === null` is read before the loading test, and Rooms and Calendar say
"No rooms set up yet" - "Add them in Room types." (`pages/StayView.tsx`).

**Proved** — `src/modules/front-desk/stayViewNoRooms.test.tsx`, "says so in
the owner's words instead of loading forever": `getStayView` answers `null`,
and the screen shows both sentences and no skeleton. The commit records it
passing on the fix and failing on the old code. Moved here 25 September.

**The rule** — `null` is an answer, not a wait. A loading test written as
`!data` cannot tell them apart.

### FD-1 · Two "in house" numbers for the same moment — FIXED 17 September

**Found** — 14 September, comparing screens: the property page said In house 11 / Vacant 9 while the Dashboard and Rooms said 10 / 7.

Two definitions — stays against rooms, sold tonight against occupied now — and neither is labelled, so nobody can say which is right.

**The fix, when it is done** — Pick one definition, name it on both screens, and derive the other from it.

**The rule** — One definition, or two screens disagree and nobody can say which is right.

**Fixed by the master, 17 September — the owner's D17-10: "In house" is guests
checked in now.** The cause, measured locally: the In house page (`listInHouse`)
read DATES — every booking covering tonight — and listed 8 rows (five not yet
arrived, three void) while the Dashboard, the housekeeping board, All bookings and
the property page read STATUS and said 1. `listInHouse` and `listDepartures` now read
status (Due out is the part of In house leaving today); the walk-in vacancy check
keeps "sold tonight" in its own function. The page reads "Guests checked in now".
Proved: `repositories.test.ts` — a checked-in day-use guest counts, a guest still to
arrive never does; both fail on the old code. Seen: In house 1 room, matching the
Dashboard's 1.

**Finished 22 September - the owner's D21-36 and D21-37.** The property page
still printed its own two numbers (every checked-in booking, and "not sold
tonight"). All five screens now read one rule, `GET /:code/house-now`
(`app.house_now`); see FD-8 and `inHouseRule.test.tsx`.

---

### FD-6 · `/stay` loaded forever when the server did not answer

**Found** — the design critique of 16 September (P0), verified in a browser
with the network blocked. Re-verified 16 September with the local API stopped.

The whole loading logic was `if (isLoading || !data) return <12 grey bars>`.
Three roads led to it staying there for good:

1. **The API unreachable.** The read fails, `isLoading` goes false, `data`
   stays undefined — bars forever, under the offline bar's promise that
   "Anything you can still do will be held".
2. **The device offline.** React Query does not fail the read, it PAUSES it
   (its default `networkMode`), so there was not even an error to branch on.
3. **A hotel with no rooms** answers `null` — FD-5, still open.

**Fixed** — 16 September, `pages/StayView.tsx`. Four states:

- **Loading** — a skeleton in the house's own shape: tiles on Rooms, the
  fortnight grid on Calendar, under the real heading.
- **Nothing ever loaded, server unreachable or erroring** — `ErrorState`,
  "The rooms did not load", with **Try again**. For an unreachable server the
  sentence is our own: `api()`'s ends "Showing the last data received", and
  there is nothing to show.
- **Device offline, nothing loaded** — "No connection"; no retry button,
  because the read resumes by itself when the device is back.
- **A later read fails** — the last good house STAYS, with a strip above it:
  "No connection — these rooms are as they were at 7:23 PM. The fortnight from
  1 Sep 2026 has not loaded." and **Try again**. Yellow for no connection, red
  with the server's own sentence for a server error, as the offline bar does.

**⚠ Not `placeholderData`, although the critique named it.** React Query shows
a placeholder only while a query is PENDING and drops it the moment the query
fails (`query-core/src/queryObserver.ts`, "use placeholderData if needed").
Paging to a week the server cannot give would have emptied the screen exactly
when the house was needed. The page records the last window that loaded —
this hotel's, on this business date only (Rule 5) — and reads it back from
the query cache, which keeps it for a week.

**Proved** — `stayViewStates.test.tsx`: loading in the house's shape → did
not load → Try again → rooms; and a failed next fortnight keeping all the
tiles under the strip. Each seen to fail with its half taken out: without the
error branch, test 1 stops at "The rooms did not load"; without the kept
window, test 2 finds no strip. In the browser, API stopped: all 17 tiles kept
under the strip, guests' names readable (screenshot); a reload shows the error
and Try again; with the API back, Try again returns 17 tiles and 7 names. At 375px the strip is 105px high, Try
again is 44px, nothing scrolls sideways.

~~**Still true after this**~~ — a RELOAD with the server down could not show
the last house, because `PERSISTED` in `App.tsx` named `tape-chart`, which
matches no query key. **Closed 24 September** by the admin lane (D22-23, the
owner): `PERSISTED` keeps `stay-view`, so a reload shows the last house; the
names under the tiles (`stays`) are deliberately not kept on the device.

**The rule** — a library feature named for what you want is a claim about
what it does; read the condition it runs under. And a loading branch is only
finished when failed, paused and empty each have somewhere else to go.

### FD-2 · `const USER = "front desk"` in check-in and the walk-in

**Found** — 15 September, writing the brief (`WalkInFlow.tsx:27`); root
MEMORY 256 named the one in `CheckInFlow.tsx:26`.

**What it actually was** — checked 16 September before fixing, and not what
the entry assumed. Both flows sent the literal as `user` in the request body,
and **neither route ever read it**: the check-in body declares `user?` and
never uses it, the walk-in body does not declare it, and nothing under
`api/src` reads a request's `user`. The server records the person from the
signed-in session, `app.current_user_id()`. So no document or log ever named
"front desk" — the literal was dead data, a second answer to "who did this"
waiting for somebody to start trusting it.

**Fixed** — 16 September. Both literals, both `user:` fields and the `user`
member of `checkIn`'s and `createWalkIn`'s input types are gone, with a comment
where it was saying why. NOT replaced with the session's name, which the entry
proposed: a name the server ignores would be the same dead field with a
plausible value in it. **This differs from the fix the entry wrote down — the
owner was told, and may prefer the other.**

The server's check-in body still declares an unused `user?` in
`api/src/modules/front-desk/operations.ts`, which was off-limits this round
(RES-2 part 2). Harmless; remove it when that file is next open.

**Guard** — `actorFromSession.test.ts` fails on `const USER = "…"` or a
`user:` field anywhere in this folder's sources, and first proves it read the
folder. Seen to fail with the literal put back, naming all three lines.

**The rule** — before fixing where a value comes from, find where it goes. A
field nobody reads is removed, not corrected.

### FD-4 · A phone showed the table because of a setting nobody had touched

**Found** — 16 September, measuring the five stay screens at 375px. `StayTable`
has had a purpose-built card view since the start, behind a table/cards toggle
remembered in `localStorage` under `fidato-stay-view`. The default is `table`,
so a clerk who had never found the toggle met a table wider than their phone
inside a sideways scroller — on Arrivals, In house, Walk-ins, All bookings and
Folios.

**Fixed** — 16 September, the owner's decision. Below `sm` the cards render
whatever the toggle says, and the toggle itself hides — at a desk it is a real
choice, on a phone there is nothing to choose. Measured after: 10 · 9 · 21 · 86
· 5 cards on the five screens, nothing outside the viewport, no page scrolling
sideways; at 1280 the table and the toggle are exactly as they were.

**Two things to know before touching this file again:**

1. **There are two card renderers now.** `DataTable` grew its own card mode the
   same day, for every other list. On these five screens that mode still
   renders inside the `hidden sm:block` wrapper, where nothing can see it — dead
   markup, not a second list on screen. Do not "fix" it by deleting the
   wrapper: that shows both.
2. **The guard is `data-stay-cards`**, on the `ul`. Before it existed the test
   matched any `ul` inside a `sm:hidden` div, which `DataTable`'s own cards also
   satisfy — so the guard passed with the stay cards removed. Proven by
   removing them.

**The rule** — When a second component grows the same shape, a test that
matches the shape stops testing the thing. Mark the one you mean.

### FD-3 · A refused walk-in left a guest that can never be deleted

**Found** — Root MEMORY 243, by an audit rather than a test.

The walk-in route refused below an insert; `withSession` committed the insert anyway, and guests are not deletable (015).

**Fixed** — The route now makes every check before its first write. **This is the worked example for RES-1 in reservations** — copy it rather than solving it again.

**The rule** — A refusal written below an insert keeps the insert.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **3** · A check-in ran and nothing changed on screen — Rule: if an action does not move a number on screen, it is not finished.
- **13** · Adding the column is not the fix — Rule: a fix has a writer and a reader. Adding a column, writing it, and reading it are three changes, and the one that reaches a person is the read.
- **14** · A gate that reads a different source from the action it guards — Rule: when an action moves, its GATE moves in the same commit. A gate that consults a different source from the action it guards is not a gate.
- **16** · A write that went nowhere, found by an audit not a test — Rule: after moving a module's transport, grep the WHOLE seam for the old one.
- **28** · A constraint the schema documents at length and does not have
- **40** · A boolean where a document should have been
- **42** · Splicing by the first match when the pattern appears twice
- **50** · Seventeen pixels per day
- **51** · Pinned, and underneath
- **65** · The invented prices had a second home in the frontend
- **66** · Two controls on the busiest screen that did nothing
- **67** · Guessing a constraint's allowed values, twice in one session
- **68** · Counting across every property and reporting it as one
- **98** · The browser's clock instead of the hotel's day
- **99** · Say the most actionable true thing, not the first one found
- **101** · Order of operations against a guard
- **118** · A route that could never run, under one that could
- **137** · A note about what is not built, left after it was built
- **138** · A deposit is not an overpayment
- **139** · The same reason, twice, because I did not read the line below
- **141** · A gate that compared a value with itself
- **142** · The refusal was right and the data was wrong
- **143** · "The same panel" was a second copy of it
- **145** · A button that could be pressed twice took two rooms
- **146** · The room they were already in was not on the list
- **150** · Four tests that only passed after 2pm
- **152** · A VALUES list infers parameter types; a SELECT does not
- **156** · A guard with no way through is a wall — Rule 6 says a blocked action is shown WITH its reason. It does not say the reason is the end of the conversation.
- **157** · The other end of the same feature had no guard at all
- **158** · A charge posted to the configured date, not the real one
- **163** · Only a check-out dirtied a room — The rule belongs where the fact is.
- **164** · The badge row existed twice, and had already drifted
- **165** · A tile that said FREE and named the guest in it
- **166** · A test that passed with the bug put back — twice
- **167** · A control at x=477 in a 375px viewport
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **171** · A moved guest was charged for the night TWICE
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **242** · "Required" went on one of the two doors a booking comes through — The rule, again: "required on every X" starts with finding every statement that makes an X
- **243** · A refusal written below an insert keeps the insert — The rule: inside `withSession`, a refusal is a COMMIT.
- **246** · "Rack rate ₹0" for a room type nobody had priced
- **247** · Every departed guest's panel said "Tentative"
- **248** · The stay panel existed twice, and the drawer had no padding
- **249** · A fix made in one of ten places: departed group rooms read "Room —" — The rule: when a fix lands in one query, grep for its siblings before calling it fixed.
- **252** · The menu's "Calendar" link opened Rooms
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.
- **258** · The Rooms screen named every room state twice — and my plan to fix it was wrong twice — The rule: rename a number by what it counts, never by what the word sounds like.
- **265** · The desk still said "folio" in three places after step 1 — one of them untrue as well — The rule: a vocabulary sweep reads every sentence the role sees — dialogs and banners, not only labels. And a sentence that says where something is kept is a claim: trace it to the write.
- **268** · My first placement of the card left the Rooms screen 41 pixels of rooms on a phone — The rule: anything added above a full-height screen is measured at phone size before it is called done.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
