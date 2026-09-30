# Front desk — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-30 · The walk-in route is gone (Rule 2b: no dead code)

**Asked for:** the master's cleanup lane. `POST /:code/walk-ins` has had no screen since 29 September, when New booking's one page took the walk-in (D27-158). Branch `cleanup/walk-in-route` from cp6 dfc5d39, copy `.claude\worktrees\quizzical-bouman-ff2071`; no servers, no database of its own (`npm test`'s scratch one only), no migration. Front desk was held by `fix/booking-bill-30sep` at the start; the master said to go ahead, the files being disjoint, and the claim was taken once that lane let go.
**Shipped:** the route is out of `api/src/modules/front-desk/operations.ts` (346 lines, and two validators its import no longer needs), its rule and `WALK_IN` out of `api/src/roleGate.ts`, its pattern out of `src/lib/offline.ts` (core, asked for by the master). Callers before the cut, by grep: five API test files, roleGate and the offline queue - no screen, no other service.
**Tests moved onto the booking plus the check-in**, which is what "Check in now" sends: `guards` (segment, source, seller, single lady, the reference, the Walk-in channel, NULL not empty, a switched-off channel, a refusal that leaves no guest), `deskChecks` (the ID or a reason, the Aadhaar, the skip reason kept, -2 nights, children, phone, email), `inHouseRule` (FD-8, D21-36, rule A's fixtures), guests' `formIII` (asked what check-in asks; lands on the register), guests' `oneGuestOneRecord` (YES keeps her record and both ticks; Guest 360's real charge is now posted through `/stays/:id/charges`, the check-in posting no room night). `offline.test` pins check-in, assign and unassign. Reservations' `reservationInserts` said "two doors" and now says one.
**Found:**
- FD-23 (open): a returning foreign guest checked in from the one page with the ID block's default "IN" is rewritten to IN and leaves the Form III register. The walk-in route guarded it; the check-in never did. Run as a probe: expected 409 and GB, got 200 and IN. The case "keeps a returning foreign guest foreign when the form says IN" is out of `formIII` until the owner's answer.
- The booking has no limit on nights: FD-6's "at most 90" lived in the walk-in route and in Change dates, not in `makeBooking`. The row "Nights 400" is out of `deskChecks` until the master's answer (reservations' file).
- What a clerk no longer reads: "A manager can switch it back on under Configuration → Booking sources" when no Walk-in source is on (the booking says "That booking source is not on the list any more.").
- Left with no caller, none of them front desk's to remove: `app.walk_in_source()` (085; a migration), `canConfirmWalkIn` and `rateOverrideNeedsReason` in `src/lib/rules.ts` (the master's, noted 29 September), and the night audit's whole-stay line rule (D24-14), which now serves only walk-ins taken before today.
**Proved:** each file alone, `cd api && npm test -- <file>`: guards 45, deskChecks 14 (was 15), inHouseRule 14, formIII 14 (was 15), oneGuestOneRecord 28, roleGate 63 (its "no rule names a route that is not mounted" is the pin), reservationInserts 2 - all passed. Web `npx vitest run` 812 passed; `npx tsc -b --force` and `api` `tsc --noEmit` exit 0; strip-check 165 files; oxlint 0 errors. No screen changed, so none was opened.

## 2026-09-30 · Booking and bill (D27-187, D27-193)

Branch `fix/booking-bill-30sep`, the booking and bill lane; the whole account is reservations' CHANGELOG, same date. Here: a check-in more than a day early shows the move and its cost and needs Confirm, `confirmMove` on the server (FD-22; dayAndRoom, earlyCheckIn); Change rate and View voucher on the panel's menu (changeRateBeforeArrival); `/stays/:id/inclusions` answers 404 on a bad id (FD-21, badStayId).

## 2026-09-29 · Check-in on one page; the walk-in is New booking's page (D27-158, D27-163)

Branch `frontdesk/one-page-29sep` (from cp6 7980862; cp6 59df358, round F, merged in), copy `.claude\worktrees\modest-wilson-2807a1`, database `fidato_s32`, API 8873, web 5273.
**Shipped:** `flows/CheckInFlow.tsx` - the five steps (Guest, Room, ID, Rate, Done) are one page under one Check in: Arrivals, row, Check in, Check in (8 clicks to 3). Same boxes, same call, same body; the ID is guests' shared `GuestIdFields`. Check in is greyed with its reason under it, "Pick a room." until a clean room is chosen (the speed lane's finding 6). `pages/StayView.tsx` - a free room's tile and the Calendar's empty cell open `/h/:code/book?room=&date=`. Removed `flows/WalkInFlow.tsx` and the client's `createWalkIn`; the server's `POST /:code/walk-ins` stays, called by no screen. Front door: `checkIn`, `assignableRooms`, `listInclusions`, `addStayInclusion` for the one page.
**Found:** FD-20, the room tiles cut their pill at 390 px - fixed (7c0373e).
**Proved:** checkInChecks (+ "Pick a room"), earlyCheckIn, formIIICheckIn, refusedControls (+ a free tile opens the page on its room and today), actorFromSession: all passed. On screen: Lata Bhosale checked in to 209 from Arrivals in one page; a walk-in from free room 208.
**Left open:** `canConfirmWalkIn` and `rateOverrideNeedsReason` in `src/lib/rules.ts` (the master's) have no caller now.
**Commits:** 999cf18 (front door), 20336aa, c59ad92, 7c0373e.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part D: one occupancy, Sellable 17, EP not RO, dates and words (D27-151, D27-164; QA FD-10, FD-12, FD-13, FD-14, FD-15, FI-18, BK-9, BK-10, RO-4)

**Asked for:** the master's part D, after round D merged. Branch `fix/leftovers-28sep` (cp6 7c52bb9, round D, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:**
- D27-151: the Calendar footer's occupancy counts nights as the Manager report does (bookings confirmed, in house or checked out, complimentary in; no-show, tentative and day use out) - `data/stayview.ts`. 26 Aug on fidato_s30: 35%, as the Dashboard (was 41%).
- D27-164: the chip that counts the sellable rooms reads "Sellable 17" (FD-13); check-in and walk-in offer "EP · Room only", "CP · Room + breakfast", "MAP · Room + breakfast + one meal" and no RO - a booking already on RO keeps it (FD-15, `MEAL_PLAN_CHOICES` in `data/operations.ts`).
- FD-10: the check-in room step names "Occupied" and "Guest still in" (it said "clean").
- FD-12: the amend and walk-in dialogs print dates as 25 Aug 2026. FD-14: "Left empty, the rack rate is charged."
- FI-18: "₹784 over" has a real space (`StayTable.tsx`). BK-10: a voided booking reads "Void". BK-9: More options points to Assign room on the Calendar.
- In house and Due out skip the per-stay bill reads for a role without bills (round B's note).
Wording only in CheckInFlow and WalkInFlow (D27-158).
**Proved:** `data/stayview.test.ts` "counts a night as the Manager report does…" fails with the old footer ("41.2 to be 35.3"); web front-desk 12 files, 72 passed; tsc -b exit 0. On screen: Calendar "Sellable 17", 35% for 26 Aug; Folios "₹784 over"; the walk-in form "Room 209 · arriving 26 Aug 2026", its plans and the rack line.
**Not seen on screen:** FD-10 - every arrival on 26 Aug has its room still held by a due-out guest, so Check in is disabled and the room step cannot open on this data.

---

## 2026-09-28 · Fix round D: the ID step, the counts, the room slept in (QA of 28 Sep)

**Asked for:** D27-116 - the QA's Front desk table; the owner's answers of 28 Sep.
**Shipped:** QA FD-1 - the walk-in asks every guest for an ID or a reason, keeps
an Indian guest's document, notes a skipped one. QA FD-2/FD-3 - the ID rules
(guests' identityProblem) at check-in and walk-in; the summary shows an Aadhaar as
"ending 0124" (D21-18). QA FD-4/FD-6/FD-9 - Change dates and the walk-in refuse
children -1, a cleared date, -2 or 400 nights (at most 90). QA FD-5 - migration
154 and the ORDER BY in stays.ts (and five other services' copies): the room left
last. QA FD-7 - the walk-in's phone and email. QA FD-8 - adults 0 stopped at step
1 and refused in words. The check-in's ID checks sit below the room checks (the
master's report). "Edit guest" in the stay panel (GU-1), "Cancel this booking"
beside Void (BK-1).
**Proved:** api front-desk/deskChecks.test.ts 15 (all fail on the old
operations.ts), dayAndRoom.test.ts FD-5 (105 without, 106 with); web
checkInChecks.test.tsx 2, walkInReturning.test.tsx 6. On screen: the walk-in's ID
step, "12ab" and -2 nights refused, checked in FH-5EL-2608-5032 with its Aadhaar
kept; the wizard's adults 0, "12ab", "Aadhaar ending 0124".
**Left open:** check-out's "Are you sure?" (D27-117) is round A's (FolioPanel).
Cosmetic rows wait for the pilot.
**Commits:** 0a1eaab, a6d510e, 750c2c1, 8919792.

---

## 2026-09-27 · Touched by the reservations session: Cancel a waiting booking (D27-64)

`StayActions` shows "Cancel this booking" (reservations' `CancelWaitingFlow`)
in place of Void on a booking waiting for the hotel. See
`src/modules/reservations/CHANGELOG.md`.

---

## 2026-09-27 · Touched by Phase 1, New booking (reservations session)

`assignRoom` on the front door (New booking's room pick); `StayActions` offers "Confirm the booking" on a waiting booking; `StayTable` labels status `tentative` "Waiting for the hotel".
See `src/modules/reservations/CHANGELOG.md`, 27 September.

---

## 2026-09-27 · Form III at the desk (D27-25) - the guests lane's

The guests lane (`guests/form-iii-27sep`) changed this service's files for
Form III, written in full in the guests changelog of the same day: the check-in starts from the nationality on file and always sends it; its ID step takes the guests service's `ForeignGuestFields`; the walk-in asks nationality and, for a foreigner, the document and the fields, and takes its market segments from reservations' `MARKET_SEGMENTS` (Phase 1's one list; exported from reservations' front door) rather than its own inline copy; the late check-out passes on the next destination; the server's check-in, walk-in and check-out apply the guests service's rule before their first write (`api/src/modules/front-desk/operations.ts`). Test: `formIIICheckIn.test.tsx`.

---

## 2026-09-26 · Compliance first fixes: ID reads (D25-38), offers opt-in (D25-39), cash of ₹2 lakh and the PAN (D25-40), FSSAI (A16)

**Asked for:** the master, for the owner's D25-38 to D25-40 and the audit's
A16 (`docs/SELLING-IN-INDIA.md`): branch `compliance/first-fixes-26sep`. The
whole lane is written here; guests, reports, marketing, crm, reservations and
admin carry a line each pointing back. Finance, POS and online check-in are
other lanes' (held at the time): the owner said yes to small separate changes
there (D26-5), and they are listed below, not in those services' logs.

**The owner's answers, 26 September** (recorded as D26-5 to D26-11; and
D26-12, no headless Edge from any session - this lane's screenshots were taken
with it before that, and its profile showed the owner's account: reported to
the master, profile deleted): small changes in the held services; guests never asked get no offers;
the yes is asked at booking, walk-in, check-in, the guest's page and Guest 360,
a later answer replacing an earlier one; cash counted "stay, group and day",
refunds not subtracted; PAN, or "Form 97 taken", or a foreign guest, else
refused; the till the same per bill; FSSAI built as a per-hotel setting.

**Shipped**
- **A · D25-38.** `api/src/roleGate.ts` asks the role on three reads too
  (`READ_RULES`): `GET /form-c` and `GET /reports/c-form` take `customer: edit`
  (owner, admin, GM, hotel manager, reception - who may record Form C), and
  `GET /online-checkin` keeps its own `DESK_ROLES`. Every other read is
  unchanged. The Form C and C-Form menu entries (`canSee`), their route guards
  (`RequireAccess`) and the All reports list (`mayReach`) follow.
- **B · D25-39.** `offer_opt_ins` (migration "offers only with a yes"): a yes
  against the phone or email for the whole group, as D21-22's no;
  `app.record_offers_yes` takes that key's no away and `app.record_no_offers`
  its yes. The booking form, the walk-in (`ConsentTicks`, "Guest agreed to
  offers", off until ticked), the check-in's last step, the guest's own page
  (recorded at once, `recorded_by` null) and Guest 360 (`/crm/offers-yes`,
  owner/admin/GM) record it. Marketing's `mayBeWrittenTo` needs a yes and no no.
- **C · D25-40.** `app.cash_taken(stay, day)` (migration "cash limit and
  PAN"): this stay, its group, and the guest's other stays that business day;
  a reversed payment left out, a refund never subtracted.
  `api/src/modules/finance/cashLimit.ts` holds the two sentences; the desk's
  `POST /stays/:id/payments` and the till's settle ask them **before any
  write**. PAN (capitals, `ABCDE1234F`) or Form 97 kept on `payments` and on
  `pos_orders` (with `non_resident` at the till). The Settle dialog and both
  till screens show the PAN box above ₹1,00,000.
- **D · A16.** `hotels.fssai_number` (14 digits or null), `PUT
  /hotels/:code/fssai` (owner, admin, GM: room setup), a card on the hotel's
  page, a line on every restaurant bill, and on a tax invoice with food,
  drinks or minibar lines.

**Every read that returns an ID field** (grep `id_number|passport|visa` in
`api/src`): `GET /form-c` (passport) and `GET /reports/c-form` (passport,
expiry, visa, address) - now gated; `GET /online-checkin` (the guests' own
details, Aadhaar masked) - gated since 21 September by `DESK_ROLES`; the
guest's own page (`/api/guest`, link + code, the guest's own data). Not ID:
the invoice prints the guest's address from `guest_documents` (the issue
route, a write gated by `invoice: create`). ID photos: not built (D21-11).

**Found**
- GUE-2 (open): the Form C register prints a long dash for a stay with no room,
  from `app.form_c_due` (025) - against D17-48.
- The till's order read hides an order the group owner opened from a GM
  ("No such order") - pos's, told to the master.
- The route guard's refusal reads "which does not include customer" - the
  shared `RequireAccess` names the resource; told to the master.
- `/api/pos/tickets` (an outside till's door) is not asked the cash rule.

**Proved** - the six checks on `78141bf` (cp6 `995982b` merged in), 26
September 23:21 to 23:37, every one exit 0: `tsc -p tsconfig.app.json`
clean; `api` tsc clean; web 80 files, 705 tests; API 99 files, 1562 tests;
database 1179 assertions (crm 25, cash limit 5, front desk's others as before);
the replay "all 143 migrations are re-runnable". Each rule was seen failing
with it taken out and passing with it back: the Form C read rules (housekeeping
got the register, 200), the Form C menu rule (the accountant and viewer could
reach it), a yes taking the no away (database), the check-in's yes (Rohit's
email missing), marketing's yes check (two list tests), the desk's ₹2 lakh
refusal (three tests), a reversed payment left out (110000 counted, not
100000), the till's ₹2 lakh refusal, the FSSAI 14-digit check (500, not 409).
Screens at 1280 and 390 wide in `.local/screenshots/2026-09-26-compliance/`
(A1-A4 Form C and C-Form refused for housekeeping, shown for reception; B1-B5
the offers tick at booking and check-in, Guest 360 before and after the GM's
yes, the guest's page; C1-C4 the PAN box, the PAN refusal, the ₹2 lakh
refusal, the till; D1-D3 the FSSAI setting and the restaurant bill).

**Left open**
- The outside till's tickets and the cash rule; a list of PANs and Form 97s
  for the CA (Form 98) - neither in this brief.
- The FSSAI number is read live on an invoice, not frozen at issue as the
  GSTIN is (`ponytail:` note in `invoices.ts`).
- Two clerks taking cash for one guest in the same second can both pass
  (`ponytail:` note in `postings.ts`).

**Commits:** `0f5ca78`, `2e2a4f0`, `78141bf` (with merges of cp6 `1cd306c`, `5e963d4`, and the last one), and this note.

---

## 2026-09-26 · FD-7 held by a test

**Asked for:** the owner's D25-27 (a test for each fix built but held by none, then close it; no behaviour changed), in the five-tests session, branch `tests/five-25sep`. **Shipped:** `front-desk.test.tsx`, "puts Today, once a week is paged, in a row that wraps (FD-7)". **Proved:** seen failing with `flex-wrap` taken out of `StayView.tsx`; passes on the fix. FD-7 moved to Fixed. **Left open:** no 375px browser measurement this time; the class is what is held. **Commits:** `689f837`.

---

## 2026-09-25 · The check-in's line to Online check-in (D25-4), from the room cards session

**Asked for:** the owner's D25-4, in the room cards session
(`online-checkin/room-cards-25sep`), with the master's agreement to touch this
folder: in the check-in's ID step, only when THIS booking has details waiting
from the guest's own page, a line to Online check-in in a new tab.

**Shipped** - `flows/CheckInFlow.tsx`: one import from online check-in's front
door and `<WaitingDetailsLink reference={stay.reference} />` under the ID
step's first paragraph. The line and who sees it (the desk's roles only) are
online check-in's (`WaitingDetailsLink.tsx`).

**Proved** - `earlyCheckIn.test.tsx`, "the ID step, when the guest sent their
details online > points to Online check-in" (fails with the line taken out of
the check-in: no such link).

---

## 2026-09-24 · Polish A-E: controls the server refuses (D24-27), own role (D24-28), FD-16, FD-17, the printed Night audit

**Asked for:** the master, for the owner's D24-27 and D24-28 and two open
defects: branch `front-desk/polish-24sep`. **A** - hide every front desk
control the server refuses the person looking (housekeeping first), each
asking the server's own question; the late check-out's waive from the
server's `mayWaive`. **B** - a GM or hotel Admin may not change their own
role on People. **C** - FD-16. **D** - FD-17. **E** - the printed Night
audit's Room Charges and Checked Out columns overlap.

**The owner's answers in this chat, 24 September**
- "Settle and check out" (it opens the Bill tab, where both the payment and
  the check-out happen): **shown to whoever may settle OR check out** - the
  Accountant keeps it; only roles that may do neither lose it.
- The stay panel's "Check in" and "Agreed to WhatsApp" tick, which the
  server also refuses housekeeping and D24-27 did not list: **hide both**
  (D24-18).
- A Rooms tile whose guest leaves today, with the room given ahead to
  today's arrival, printed the arrival's name under "Due out": **fix now -
  name the guest in the room** (FD-18).

**Shipped**
- **A** - each control asks roleGate's question of its write, from the one
  matrix (`can(role, ...)`): a free tile and the Calendar's cells open a
  walk-in only with `reservation: create` (otherwise a plain tile, a plain
  cell - not a disabled button); the panel's Check in and More options with
  `reservation: edit`, its Void with `cancel`; Mark VIP and the WhatsApp tick
  with `customer: edit`; Settle and check out with `payment: create` or
  `reservation: edit`. `LateCheckOutFlow` reads `mayWaive` from
  `GET /:code/early-arrival` (the Bill tab has already asked it), as the
  check-in does. Files: `pages/StayView.tsx`, `flows/HouseFloor.tsx`,
  `flows/StayDrawer.tsx`, `flows/StayActions.tsx`, `flows/GuestMarks.tsx`,
  `flows/LateCheckOutFlow.tsx`. Who may do what is unchanged.
- **FD-18** - `pages/StayView.tsx`: an arrival never replaces a guest
  already named for that room.
- **B** - `api/src/modules/admin/admin.ts`: `POST /admin/staff/:id/access`
  for yourself, and `POST /admin/staff` with your own address and a
  property (the second door: it brings back a person already there and
  upserts their row), both refuse first - "You cannot change your own role.
  Ask the owner or an administrator to do it." People needed no change:
  nothing on your own row changes your role (admin's ADM-8).
- **C** - FD-16: the check-in's fallback is `resolveDate`, the swap's
  `businessDateFor`, and the groups list's "current" test
  `app.business_date($1)` - the same stale read, found beside them.
- **D** - FD-17: in `stays.ts`' one query, a released assignment counts for
  every status except `confirmed`.
- **E** - `api/src/reportRender.ts` (the shared renderer, every report's
  PDF): a section keeps its fixed shares (text 2.6, figure 1) while
  everything fits; where anything would not, each column is sized to the
  widest thing it prints, the spare width shared out, and a section still
  wider than the page prints in smaller type. Sections that fitted print as
  before.

**Found**
- The stay panel's Bill tab (finance's `FolioPanel`: Add charge, Settle,
  Interim bill, Split bill, Check out) is also offered to housekeeping and
  refused by the server. Finance's files; told to the master.
- Other reads of the frozen `hotels.business_date`: the channel manager's
  ARI (`greatest(h.business_date, today)`) and `pos/till.ts`. Not ours; told
  to the master.
- An unassigned booking cannot be opened from a Rooms or Calendar link (no
  bar to find); Arrivals opens it. As before.
- Demo room 201 has two checked-in guests (FD-11's old case); its tile names
  one of them under "Due out". Data from before FD-11; not changed.

**Proved** (this copy, database `fidato_s6`, API 8819, web 5219)
- The six, on cp6 `acf10a8` merged into this branch (`9caa0cb`, migration
  138 from finance; none from here): `npx tsc -p tsconfig.app.json
  --noEmit` exit 0; `cd api && npx tsc --noEmit` exit 0; `npm test` 71
  files, 661 tests, exit 0; `cd api && npm test` 94 files, 1463 tests, exit
  0; `bash db/tests/run.sh` all 1154 assertions, exit 0; `bash
  db/tests/rerun.sh` all 138 migrations re-runnable, exit 0.
- Each fix's test fails without it (the change set aside, the test run,
  the change put back): **A** - `refusedControls.test.tsx` on the old
  screens, 6 of 7 fail (free tiles "expected [BUTTON...] to not include
  'BUTTON'"; the Calendar "got 238"; tile 204 "expected 'Lata Bhosale' to
  be 'Ganesh Patil'"; the panel for housekeeping and for the Accountant;
  the late tick for a hotel admin); the 7th, a GM still offered the waive,
  holds either way. **B** - `propertyAdmin.test.ts` and
  `addPerson.test.ts`, D24-28: "gm: expected 200 to be 409" on both doors
  (two more in the file fail as knock-ons). **C, D** - `dayAndRoom.test.ts`
  on the old routes, 4 of 5 fail with the defects' own words; the 5th
  (departed stays keep their room) holds either way. **E** -
  `api/test/reportColumns.test.ts`, the Night audit of every demo day
  (1-25 August) printed through the file route, every cell and heading
  measured against its column: old renderer, 474 different strings too
  wide ("Rent Date", "Nrml. Tariff", ...); new, none.
- Screens, `.local/screenshots/2026-09-24-polish/` in the main folder,
  desktop 1280x800 and phone 390x844, headless Edge over its debugging
  port, each with what the page itself reported: `01-*` Rooms for
  housekeeping (no Assign room, free tiles plain), `02-*` Calendar for
  housekeeping (0 Book room cells), `03-*`, `04-*` the stay panel for
  housekeeping (no Check in, Settle and check out, Mark VIP, WhatsApp tick
  or More options); `05-*` to `08-*` reception's (all of them, 238 cells);
  `09-*` the Accountant's (Settle and check out only); `10-*` People, the
  GM's own row (Password, Edit); `11-*` tile 204 names Ganesh Patil with
  Lata Bhosale held for 204; `12-*`, `13-*` after she is taken out (tile
  204 Ganesh, Arrivals shows her with no room); `14-*` to `17-*` the
  printed Night audit of 20 and 24 August before and after, and the PDF.
  Setup in `fidato_s6` only: the Start here card put away for the roles
  photographed, Lata taken out of 204.

**Left open** - FD-10, FD-12, FD-5, FD-7 as before; the Bill tab's controls
(finance).

**Commits:** `4b8dfe2` (A-E and tests), merge `9caa0cb`, and these notes.

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
- The six, on cp6 `c57d7ee` merged into this branch (migration 137):
  `npx tsc -p tsconfig.app.json --noEmit` exit 0; `cd api && npx tsc
  --noEmit` exit 0; `npm test` 70 files, 653 tests, exit 0; `cd api && npm
  test` 92 files, 1455 tests, exit 0; `bash db/tests/run.sh` all 1151
  assertions, exit 0 ("moved-out room" 9/9); `bash db/tests/rerun.sh` all
  137 migrations re-runnable, exit 0.
- Each fix's test fails without it: **A** - `inHouseRule.test.ts` on the old
  routes, 6 of 14 fail (walk-in sentence; move, swap, assign "expected 200
  to be 409" or another sentence; the sixth a knock-on of the old move going
  through). **B** - the database suite with 137's trigger left out: "moved-out
  room" 8 passed, 1 failed, "got clean". **C** - `earlyCheckIn.test.tsx` on
  the old screen, "expected <input> to be null"; the route's answer,
  "expected undefined to be false". **D** - `onlineCheckin.test.tsx` on the
  old page, the words never shown. **E** - `groupLead.test.tsx` with the
  wrong id sent, "res-a" for "res-b". **F** - `front-desk.test.tsx` without
  the guard, "expected <button> to be null". **G, H** - ADM-8.
- Screens, `.local/screenshots/2026-09-24-follow-ups/` in the main folder,
  desktop 1280x800 and phone 390x844: `01-move-refused-names-guest-*` ("Not
  moved: Ganesh Patil (FH-2608-5004) is still in room 204. Check them out
  first, or choose another room."), `02-walk-in-refused-names-guest-*`
  ("Could not check in", the same words), `03-check-in-waive-hidden-hotel-
  admin-*` and `03-check-in-waive-offered-owner-desktop`, `04-guest-page-
  messages-sent-and-handled-*`, `05-rooms-board-assign-room-hidden-
  housekeeping-*` and `05-...-shown-reception-desktop`, `06-people-gm-own-
  row-no-switch-off-*`. Taken with headless Edge driven over its debugging
  port (the app's pane could not draw while hidden).

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

**Commits:** `c899565` (A-E), `f740274` (F-I and notes), `39f1ada` (137); merges
`b777b73`, `8036dba`, `c45f5d5`; and these notes.

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
