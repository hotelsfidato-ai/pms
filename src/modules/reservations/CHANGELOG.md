# Reservations — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-10-03 · The desk may overbook, per hotel; "Prepaid on the booking site" (the owner's D27-243 3.2, D27-246)

Branch `settings/phase3-2oct`. **Shipped:** `makeBooking` refuses the desk's booking - a group's whole - past a full house when the hotel's "The desk may overbook" is off (189; on by default, as D17-43). New booking shows "Prepaid on the booking site" (on) when the source is a booking site and sends it; `book.ts` writes `reservations.prepaid_on_site`. New booking starts on the hotel's title, ID and way of paying an advance. **Proved:** front desk's `frontDeskRules.test.ts` 3.2 cases.

## 2026-10-02 · Who made a booking is written (RES-14, the owner's D27-239 8.2)

Branch `frontdesk/onepage-2oct`. **Shipped:** `book.ts` writes `created_by = app.current_user_id()` on every booking. **Proved:** front desk's `feesAndDayUse.test.ts` "records who made it".

## 2026-10-01 · New booking makes a day use, its price typed every time (the owner's D27-227, D27-229)

**Asked for:** through the master. Branch `fix/dayuse-booking-1oct` from cp6 5d049167, the booking and bill lane; migration 176 (front desk's Change dates).
**Shipped:** `book.ts` takes a departure ON the arrival day as a day use (015's `is_day_use`); only a departure before the arrival is refused, and the 90-night rule counts 0..90 for a day use. A day use's price is TYPED on every booking: refused "Type the day-use price." with none typed or a zero (a complimentary room aside) - never the night's tariff (`app.tariff_for` is not asked), never a zero; any role that books may type it, no override reason. The page (`BookingPage.tsx`): Departure may equal Arrival (a day use moves with its arrival day); the hint "Day use - in and out on 2 Oct 2026. Type the day's price; it is charged at check-in."; the tariff is never asked for a day use; Save holds with "Type the day-use price."; the line reads "₹1,500.00 for the day … · day use"; the summary "Nights: Day use" and the total is one day x rooms. The night stays for sale: no inventory or channel change (the owner).
**Proved:** web `onePage.test.tsx` "a day use" (fails on the old page); API front desk's `feesAndDayUse.test.ts` "a day use from New booking" (no price and a zero refused; saved as a day use at the typed price; amended keeping its price, refused as nights).

## 2026-09-30 · The cash advance hold goes (D27-200 item 6)

Branch `fix/booking-bill-30sep`, on the master's go once the Cash lane's 165 was in cp6. A receptionist's drawer now opens by itself on the first cash, so the hold of D27-193 (RES-12) is removed from `pages/BookingPage.tsx`: no drawer read, no sentence, no held buttons; finance's `getCashierDrawer` export went with it. **Proved:** onePage 14/14, the flipped case failing on the old page (the server says no drawer is open; the advance is taken and the page never asks). Screen: a ₹1,500 cash advance with no drawer open - "Advance of ₹1,500.00 taken" on the Booked card, "Received - Cash" on the Bill tab, and Cashiering showing the drawer open since 14:37 at a ₹0 float with the receipt in it.

## 2026-09-30 · "Rate includes GST" covers the list price, as a tick beside the rate (D27-199)

Branch `fix/booking-bill-30sep`, the booking and bill lane. **Shipped:** `api/src/modules/reservations/book.ts` - the split block moved to after the tariff branch, so with no rate typed the list price is the all-in figure too (₹3,699 = ₹3,522.86 + ₹176.14; `app.tariff_for` untouched; the gap refusal and the paisa rule as before). `pages/BookingPage.tsx` - the page splits the calendar's first-night price the same way and sends `rateIncludesGst` without a rate; the sliding Switch is the kit's Checkbox under the Rate field, whose column is wider so the tick sits on one line. **Proved (failing on the old code first):** inclusiveGst 6/6 (the list-price case), onePage 14/14. Screen, desktop and 390 px: ₹3,699 list with the tick reads ₹3,522.86 + ₹176.14, due ₹3,699.00; the booking kept 3,522.86.

## 2026-09-30 · Booking and bill: the owner's walk-through (D27-187, D27-193)

Branch `fix/booking-bill-30sep` (from cp6 c01b150), copy `.claude\worktrees\zealous-wu-560bed`, database `fidato_s44`, API 8901, web 5301. Lane session "Booking and bill fixes"; the master answered D27-193.
**Asked for:** D27-187 - three bugs reproduced first (new bookings missing from Arrivals, the advance not on the bill, no GST section); charges to come on the bill; Rate inclusive of GST per room line; Change rate before check-in; View voucher; Extras off the page; three small defects (the demo loader's teardown, `/stays/:bad-id/inclusions`, the Dashboard's `<div>` in `<p>`). D27-193: the demo on today; the early check-in warned and confirmed; the cash advance said before saving; GST folded into Company.
**Found (root causes, the owner's own rows on the master's `fidato`):** RES-11 (a 1 Oct booking on a demo pinned to 25 Aug: outside both Arrivals views); RES-12 (cash refused with no drawer ever opened, one amber line); RES-13 (the GST fold read-only, no demo company with a GSTIN); FD-22 (the same booking's check-in moved it to 25 Aug: 39 nights).
**Shipped:** `npm run demo` passes `--today` (`api/scripts/demoDate.ts`, load-demo and demo-history read every snapshot date through `shift`; a check refuses to commit when arrivals on the business date differ from the snapshot's on 25 Aug; the teardown deletes rows naming the hotel without a cascade first). The one page: the cash advance's reason under Advance with the buttons held; the company's GSTIN under the picker; the summary's "GST"; no Extras. View voucher on the Booked card and the panel's menu (`viewVoucher`, a tab opened inside the press). Front desk: the early check-in's confirm (FD-22), Change rate on the panel's menu, `/stays/:id/inclusions` 404 on a bad id (FD-21). Finance: charges to come on the bill; `ChangeRateDialog` and `getCashierDrawer` on the front door. Guest messages: `GET /stays/:id/voucher.pdf`. Admin: the GST and Extras switches left `SWITCHABLE` and the Settings card. Reports: REP-15.
**Proved:** each fix's test run on the old code first and seen failing: badStayId 3/3 failed then passed; reports 5/5; onePage 11/11 (3 new failed on the old page, View voucher's failed on the old card); viewVoucher 3/3 and roleGate 61/61; dayAndRoom 8/8 and earlyCheckIn 7/7 (each new one failed on the old code); changeRateBeforeArrival 2/2 (failed on the old menu); chargesToCome 1/1 (failed on the old bill); the loader check seen refusing (0 against 7). The API harness still loads 25 Aug (badStayId after the change). Screens at desktop and 390 px: the page's folds, the cash hold, the GSTIN line; the check-in's move sentence and a check-in confirmed end to end (arrival 2 Oct -> 30 Sep, the reason kept); Change rate before arrival (3,433.68 -> 3,200.00, nothing posted); charges to come (5 nights, 15,431.35, as the check-in quoted); View voucher (one tab at the PDF, checked in the page - the app's pane shows no tab a page opens itself).
**Then, D27-195 (the owner's answers):** Rate includes GST, a switch per room line, off by default: the typed figure is split by finance's `roomRateBeforeGst` (the slab on the pre-tax value, rounded a night as the audit rounds it; the nearest total not above the typed figure, "₹502.00 can't split exactly: the bill will say ₹501.99 a night."; the slab gap 7,875.01-8,850 refused in the owner's words, on the server and the page). `book.ts` keeps the rate before GST (the approved block after the rate line; the tariff branch untouched); `GET /tax/room/before-gst` shows it on the page. A rate changed before any night is charged keeps its reason in the notes ("Rate ₹3,433.68 → ₹3,200.00: why", finance's `changeStayRate`). Proved, each failing on the old code first: inclusiveGst 5/5 (4,000 exact; 7,875 at 5%, 7,875.01 and 8,850 refused, 8,850.01 at 18%; 502 → 501.99; a booking keeps 3,809.52 and adds back to 4,000.00; the gap writes nothing), rateBeforeArrival 1/1, onePage 13/13; roleGate and newBooking still pass (88/88). Screen: the five figures against the server at desktop and 390 px; a booking at ₹4,000 inclusive kept 3,809.52 and its voucher totals INR 4,000.00.
**Left open:** the demo's companies appear three times each (the contracts lane's).

## 2026-09-29 · One page for booking, a room and check-in: three buttons, the walk-in as the page, the sections in Settings (D27-158, D27-163; "Book this lead", D27-170)

Branch `frontdesk/one-page-29sep` (from cp6 7980862; cp6 59df358, round F, merged in), copy `.claude\worktrees\modest-wilson-2807a1`, database `fidato_s32`, API 8873, web 5273.
**Asked for:** D27-158 - one page with guest, dates, room type, rate, room (optional), ID and advance; "Save booking", "Save and assign room", "Check in now"; Company, GST, Extras and Notes folding open, each switched per hotel in Settings; the rule from now: two pages or three clicks. The owner's details, D27-163: GST is the chosen company's GSTIN, read-only; Extras are the stay's inclusions; one Notes box; the walk-in becomes this page (the single-lady tick with it; the booking's 10% rule in place of the below-rack reason; Walk-in pre-chosen only from an empty room); an advance at booking is held as credit; a picked room is kept on Save booking; the four switches start ON; the arriving booking's check-in becomes one page. The master: "Book this lead" (`?lead=`, D27-170), the Phone line.
**Shipped:** `pages/BookingPage.tsx` replaces `pages/NewBooking.tsx` at `/h/:code/book`. Every button uses a door that exists: the booking call; front desk's assign and check-in; finance's payment (heldAsCredit); front desk's inclusions. Each button greyed with its reason under it (Rule 6), including the server's phone and email rules (X-2) and "Pick a room." A refused later step leaves the booking standing and the Booked card says which step and why (`flows/BookedCard.tsx`). `?room=&date=`: tonight's is a walk-in (that room, the Walk-in source, Check in now filled); a later night's a booking of that room. `?lead=`: the lead's name, phone, source and campaign; a lead gone shows its sentence. Server: `POST /:code/bookings` takes `notes`, `isSingleLady` and `campaign` (book.ts, groups.ts; campaign by its own update, only when sent). Migration 159 puts the four sections among the module switches, on until turned off.
**Clicks (from the screen the job starts on; typing and list picks not counted):**
```
job                 before                                          after
a booking           New booking, Add, Confirm - 3, 1 page           New booking, Save booking - 2, 1 page
a room              at booking 0 extra; later 3 from Rooms          pick + Save and assign room - 2; later 3
check-in            Arrivals, row, Check in, Continue x4, Check in  Arrivals, row, Check in, Check in -
                    - 8, 7 views; book-and-check-in 9               3, 2 views; a new guest: 2, 1 page
walk-in             free room, Confirm and check in - 2, 1 dialog   free room, Check in now - 2, 1 page
```
**Found (and fixed before merge):** the first room's list read "clean" for room 302 while Check in now answered "awd is in this room" - it now says what check-in says (ff4c9e4).
**Proved:** web tests (this service, front desk, guests, admin, src/test): 152 passed, 1 failed - `migrationNumbers`, the 157-160 gap the provisional number left until the master renumbers it. `onePage.test.tsx` 8/8 (greyed reasons, the order of calls and a refused check-in, the advance, a lead and a gone lead, the walk-in with the tick, a later night); four rules broken on purpose each failed it. Before the master's stop, the API's `newBooking` + `moduleSwitches` on a scratch database: 40/40 with 159 (notes and the tick stored). On screen, fidato_s32, desktop and 390 px: a booking checked in to 307 with Aadhaar and a ₹1,000 advance (FH-5EL-2608-5032, read back from the database); a walk-in from free room 208 with the tick and the Walk-in source (FH-5EL-2608-5033); Notes switched off in Settings and gone from the page; no sideways scroll at 390 px.
**Proved after the master's go (release 1 checked):** API `reservations` (bookings, newBooking, channelDoor, cancelConfirmed, reservationInserts), `moduleSwitches`, `phonesAtEveryDoor`, `oneGuestOneRecord`, `bookingReference`: 9 files, 109 passed; the notes-and-tick assertion fails with the two fields dropped from groups.ts (1 failed, 19 passed) and passes restored. `db/tests/run.sh`: all 1263 assertions passed (admin 3/3, the four sections). cp6 7a554fa merged in: tsc clean, the same 152 passed / 1 failed (the migration gap).
**Since:** leads merged (cp6 b041b5c): the page reads leads' own `fetchLeadForBooking` and the stand-in `leadForBooking` is gone; the campaign is stored (leads' 161, reservations.campaign) and a campaign over the column's 200 characters is refused in words before any write, both in the API's newBooking test. `SendCheckInLink` is on the Booked card beside Send voucher since 30 September (7d3ff32; not once the guest is in house; onePage 8/8).
**Commits:** 0ba2f49, 999cf18, 68195e1, ff4c9e4, b2f789c, c65892b, 20336aa, c59ad92, 7c0373e.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part D: New booking says what it waits for; the group page's sentences; Void found; meal plans in code and words (QA BK-6, BK-7, BK-8, BK-10, RO-4; D27-164)

Branch `fix/leftovers-28sep` (cp6 7c52bb9, round D, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** New booking: "Still needed: …" under Confirm (BK-6); its meal plans "EP · Room only" … "AI · Everything charged to the room" (BK-7, D27-164); offered only with `reservation` create, the server's BOOK rule (RO-4). The group page: one whole footer sentence and no hanging "·" (BK-8). All bookings: voided bookings in "Cancelled, void & no-show", and search finds a phone by its digits (BK-10). BK-7's "Walk-In" beside "Walk-in" is a company row in QA's database, not code; not reproducible on fidato_s30. Wording only in NewBooking (D27-158).
**Proved:** web reservations tests passed; on screen "Still needed: the guest's name." and the new tab.

---

## 2026-09-28 · Fix round D: cancel a confirmed booking, the link, the dates (QA of 28 Sep)

**Asked for:** D27-116 - every BLOCKS WORK and WRONG RESULT of the QA's Bookings
table; the owner's answers of 28 September (round D, 1, 9-12).
**Shipped:** QA BK-1 - "Cancel this booking" on a confirmed booking, THIS ROOM
ONLY, under the terms frozen on it: nothing inside the free window or with no
terms, else the retention on the bill (misc, the room's slab, as the no-show's);
owner/admin/GM may waive it with the reason; a dryRun shows the figure first
(desk.ts cancelConfirmed, CancelConfirmedFlow). QA BK-2 - `send` takes any 2xx as
the yes, so the guest's page link shows. QA BK-3 - an arrival before the business
date is refused in makeBooking, below the repeat check. QA BK-4 - nationality is
an ISO country. QA BK-12 (D27-123) - migration 153, references take the business
month. X-2/X-3 - New booking refuses an impossible phone or email, 0 adults, -1
children.
**Proved:** api reservations/cancelConfirmed.test.ts 7 (all 7 fail on the old
route), newBooking.test.ts 20, bookingReference.test.ts 6 (2609 without 153, 3103
with); web cancelConfirmed.test.tsx 2, guestLink.test.ts 1. On screen (5263):
booked FH-5EL-2608-5031, the link shown, cancelled with ₹3,699 + 5% on its bill.
**Left open:** nothing of the Bookings table's blocking or wrong rows. Cosmetic
rows (BK-5..BK-11) wait for the pilot (D27-116).
**Commits:** 8919792, a6d510e (X-3 on New booking).

---

## 2026-09-27 · Cancel a booking waiting for the hotel (D27-64, RES-5)

**Asked for:** the owner, through the master: "Cancel it directly". Three
answers the same day, all as recommended: no charge (it was never
confirmed), every waiting room of the booking, and a short reason.

**Shipped** - `POST /:code/stays/:id/cancel` in `desk.ts`: refuses with no
reason and refuses a booking that is not waiting, both before the one write;
sets cancelled, when, by whom and why on every waiting room of the booking.
The gate: the same reservation-cancel grant as the void. "Cancel this
booking" replaces Void on a waiting booking's panel (`StayActions`), through
`CancelWaitingFlow`. No database function changed: 044 already counts no
cancelled booking and 073 already releases a cancelled booking's room.

**Proved** - `newBooking.test.ts` 15 of 15, two new: a waiting booking of two
rooms cancels whole, the grid gains both rooms back, nothing on either
folio, nothing owed by `app.guest_messages_due`, nothing sent, the reason
and the clerk kept; a confirmed booking refused and unchanged. Both refusals
broken on purpose and seen to fail. `cancelWaiting.test.tsx`: the button
sends the reason to that booking.

---

## 2026-09-27 · Phase 1: New booking records every field of the owner's screenshot (D27-33)

**Asked for:** the owner, "start Phase 1" - docs/PLATFORM-PLAN.md § 3's
"add" rows, in our layout. Eight answers from the owner the same day (all as
recommended): the walk-in's segments; both lists start empty; Mr, Ms, Mrs,
Dr or none; complimentary and the lists for owner, admin and GM; a Confirm
action for a waiting booking; the summary shows what the bill will carry;
typed rates unchanged. A ninth, later that day (asked for by the redesign
session): "Waiting for the hotel" is grey on the booking lists.

**Shipped** (details in MODULE.md, "Phase 1")
- Migration 146 (renumber at merge if Form III lands first).
- `book.ts`: Waiting, complimentary (refused for other roles), the discount
  (10% by hand with a reason, more by a promotion; lowers `agreed_rate`),
  company billed, title, nationality, address, expected check-out, sales
  person - every refusal above the first write.
- `desk.ts`: the two lists and Confirm. `groups.ts`: the answer carries each
  booking's id and its status.
- Guest messages: `POST /:code/stays/:id/confirmation` (Send voucher) and one
  turn per booking that the sweep's sender takes too, so a voucher never goes
  twice (D27-35).
- The screen, the Booked card, the list dialog; "Confirm the booking" on the
  stay panel; "Waiting for the hotel" in All bookings.

**Found** RES-4 (fixed), RES-5 and RES-6 (open), in DEFECTS.md.

**Proved** - `newBooking.test.ts` 13 of 13; guards broken on purpose and
seen to fail: the complimentary role check, the 10% cap (the CHECK then
refused it: 500), the sweep's "already sent", the voucher's second press and
the waiting refusal. The screen opened at 1280 and 375 wide as owner and
reception: booked with 10% off and room 307 assigned, the Booked card, a
waiting booking held and then confirmed from its panel, the sales-people
list saved; after the last cp6 merge, a waiting booking grey on the lists
and confirmed from the restyled panel. The full suite found two of mine,
RES-7 and RES-8, both fixed. Full gates on 40b2617 (cp6 de2e98e merged in),
1,159 s, every step exit 0: web types, API types, strip (145 files), web
710 of 710, API 1,585 of 1,585, database 1,195 assertions (new-booking 15)
on 146 migrations, all 146 re-runnable.

**Left open** - advance and tax exempt (the CA, O8); the registration card
(O7); contract rates (O11); the Sales/Marketing roles (Phase 4); RES-5,
RES-6; the master's requests in MODULE.md.

---

## 2026-09-26 · "Guest agreed to offers" on the booking form (D25-39)

**Asked for / Shipped:** the compliance lane (in full in the front desk's
changelog, 26 September). The booking form and `POST /bookings` send and
record `offersAgreed` (a yes against the phone and email) in place of
`noOffers`. **Proved:** `newBookingReturning.test.tsx`,
`oneGuestOneRecord.test.ts` (the booking's yes on the list).

---

## 2026-09-24 · A test for the lead button

**Asked for:** the master, through the front desk follow-ups session - the
one missing web test: the group panel's lead button sends the right request.

**Shipped** - `groupLead.test.tsx` (new): on a group of two rooms, the lead's
own button is disabled, and pressing the other's sends exactly one POST to
`/api/hotels/5EL/groups/grp-1/lead` with `{ reservationId: "res-b" }`. No
screen change.

**Proved** - passes; with `lead()` made to send the current lead's id it
fails ("res-a" where "res-b" was pressed).

---

## 2026-09-24 · The group's lead guest, chosen on the group's screen (D22-52)

**Asked for:** the owner's D22-52 - the lead is by default the room booked
first that still stands, and the desk can assign another. Started by a helper
on `guest-messaging/group-lead`, finished on `front-desk/finish-24sep`.

**Shipped** - `POST /:code/groups/:id/lead` (`groups.ts`): the room must be in
this group at this property and still stand, both refused above the one
write (MEMORY 243); mapped in `api/src/roleGate.ts` as a change to a booking
(`reservation: edit`). `GET /:code/groups/:id` answers `leadId` from
`app.group_lead`. The group panel has a "Lead guest" column: the lead's
button carries a flag, a cancelled room's is disabled, and a press says
"<guest> leads the group - The group's confirmation and its review request go
to them."

**Proved** - the route in `api/test/modules/reputation/reputation.test.ts`
(assign, refuse outside the group or cancelled, refuse a role that may not
change a booking). On screen: pressing Kavita Salunkhe's button in the demo's
Pancham Hall function moved the flag and `app.group_lead` answered
FH-2608-5010-303 (`.local/screenshots/2026-09-24-front-desk/05-group-lead-*`).

**Left open** - on a phone the rooms table slides sideways and "Lead guest"
is at its far right, beside "Host pays". **The owner, 24 September: keep it
for now**; the panel's phone layout goes with the design work. No web test
drives the lead button.

**Commits:** `8e3c1e2` (the helper's), merged in `891790f`.

---

## 2026-09-21 · A booking may be a returning guest's, and carries the two ticks

**Asked for:** the CRM chat's phase 1 (`docs/briefs/crm.md`, D21-20, D21-72,
D21-22); the whole entry is `src/modules/crm/CHANGELOG.md`.

**Shipped** - `book.ts`: `guestId` checked again by `app.use_returning_guest`
above the first write, the guest's own name in the answer, `whatsapp_agreed`
on every room; `groups.ts`: the three fields, and "no offers" recorded in the
booking's own transaction; `NewBooking.tsx`: the suggestion and the ticks.
The fingerprint (RES-3) is unchanged; a machine sends none of these.

**Proved** - `newBookingReturning.test.tsx` (what Confirm sends, what the
clerk is told); the API half in `oneGuestOneRecord.test.ts`. Gates in the CRM
entry.

**Commits:** branch `crm/phase-1`, `1d62c8d`.

---

## 2026-09-16 · RES-2 part 2 — the booking door takes its reference from app.next_reference

**Asked for:** the master chat, after merging RES-3, RES-1 and migration 092
into cp6 — replace the inline `'FH-' || to_char(now(),'DDMM')` reference SQL
in `groups.ts` with `select app.next_reference($1)`, in the same transaction
as the insert. Not front desk's `operations.ts`: front desk switches its own
door after its current job.

**Shipped** (branch `reservations/res-2-reference`, copy
`D:\fidato-reservations`, after `git merge cp6`)
- `api/src/modules/reservations/groups.ts` — every room's reference is
  `select app.next_reference($1)`, asked inside the booking's `withSession`
  transaction, just before that room's insert. `FH-<hotel code>-<YYMM>-<n>`,
  the month on the hotel's own clock, under the hotel's lock until commit.
  The RES-3 race comment updated: two copies no longer build one reference,
  but the walk-in door's inline copy still can collide with a booking.
- `api/test/modules/reservations/bookings.test.ts` — two RES-2 tests: every
  room of a three-room booking is `FH-5EL-<YYMM>-<n>` with consecutive
  numbers; two different bookings held and released at the same moment both
  land, four different references. The hold-and-release machinery RES-3's
  race test had inline is now one helper, `heldTogether`, used by both.
- `DEFECTS.md` (RES-2: part 1 the master's, part 2 done, the walk-in door
  open), `MODULE.md` (open items).

**Found**
- Nothing in `src/` parses a reference: the other `FH-` strings are demo
  fixtures, a placeholder and the design-system page.
- **Two slips of mine in the proof, neither committed.** (1) A shell step
  turned `\\d` into `\d` inside a template literal, which JavaScript reads as
  `d` — the format test failed on a correct reference. `String.raw` now. (2)
  The break script put the old SQL back with `String.replace` and a STRING
  replacement, in which `$'` means "the rest of the input" — and the old SQL
  contains `'[0-9]+$'`. The run said "no tests": the file had been corrupted
  and nothing ran. My output filter had hidden the load error. A function
  replacement, a type check of the broken file first, and the proof re-run.

**Proved**
- `npm test -- modules/reservations` — **17 passed**, exit 0.
- Broken on purpose (the pre-092 SQL put back, type-checked clean): the
  format test failed on `FH-1609-5050` — the 16th of September — and the
  same-moment test failed with a 500 on
  `reservations_hotel_id_reference_key`. Restored, and the file compared
  byte for byte with the good copy.
- `npx tsc -b --force` — clean. `npx vitest run` — **236 passed**, 23 files,
  exit 0.
- `cd api; npm test` — **425 passed**, 34 files, exit 0.
- Not run: `db/tests` — this change has no SQL; 092 is the master's and was
  gated there.

**Left open**
- **The walk-in door** (`front-desk/operations.ts`) still makes references
  inline, with no lock, in the old `FH-YYMM-n` shape — front desk's to switch.
  Until then a walk-in and a booking at the same moment can still collide
  (a 500, nothing kept).

**Commits:** the commit that carries this entry.

---

## 2026-09-16 · RES-3 and RES-1 — the booking door a channel manager can use

**Asked for:** the owner, 16 September — RES-3, then RES-1, because the
channel manager (SU) is waiting on them. Migration 091 is this service's;
092 and 093 are the master's. For RES-1, copy the walk-in route's fix (root
MEMORY 243) without touching front desk's folder. RES-2 not started: the
master is building the shared reference generator (092), and both doors
switch to `FH-<hotel code>-YYMM-<number>` when the master says it is ready.

**Shipped — RES-3** (branch `reservations/res-3-res-1`, copy
`D:\fidato-reservations`)
- `db/migrations/091_booking_external_ref.sql` — `reservations.ota_line` and
  `ota_fingerprint` beside 005's dormant `ota_reference`; a partial unique
  index on (hotel, booking source, reference, line); a CHECK that a line
  number never stands without its reference, channel and fingerprint.
- `api/src/modules/reservations/groups.ts` — `POST /:code/bookings` takes
  `externalRef`. A repeat is looked up before any write: same details →
  `200` with the first answer and `duplicate: true`; different details →
  `409` naming the references on file. Two copies at once: the loser's unique
  violation is answered as the repeat. The desk sends no `externalRef` and
  nothing changes for it.
- `api/test/modules/reservations/bookings.test.ts` (new) and
  `db/tests/modules/reservations.sql` (new).
- `MODULE.md`, `DEFECTS.md` — RES-3 moved to Fixed, with what was done.

**Found**
- **The first race test did not race.** With the race handling deleted it
  still passed: fired with a bare `Promise.all`, the two copies never
  overlapped (most likely the second was still opening its connection). The
  test now locks `reservation_groups`, waits until both copies are held at
  the group insert, and releases them together.
- **And then its poll could not see them.** Inside a transaction,
  `pg_stat_activity` answers from a snapshot taken at the first read, so the
  gate's loop counted 0 waiting while both sat at the lock in plain view from
  another connection. `pg_stat_clear_snapshot()` before each read. I had
  first blamed the slow disk and written that into a comment; corrected
  before any commit.
- **A chained break-and-restore command hung**, and left the deliberate break
  (the race catch removed) in `groups.ts` until I stopped it and restored the
  file. Found by checking the file before anything else; nothing was
  committed from it. Breaks now run one per command.
- **The machine's Postgres is saturated by the parallel lanes.** Nine lanes'
  databases on one server; a checkpoint's sync took 557 seconds
  (4,119 files), and every `create database` / `drop database` — which every
  API and database gate run does — queued behind it for minutes. Not a code
  fault; it makes every lane's gates slow and can make a pool connection time
  out. For the master.

**Proved — RES-3**
- `bash db/tests/run.sh` — **636 assertions passed**, exit 0 (622 + 14 new).
  With the index made non-unique: 2 failed, exit 1.
- `bash db/tests/rerun.sh` — **91 migrations re-runnable**, exit 0.
- Before any change, in this copy: `cd api; npm test` — 370 passed, 29 files,
  exit 0.
- `cd api; npm test -- modules/reservations` — **10 passed** (8 new + the 2
  channel-guard tests), exit 0; tsc clean.
- Broken on purpose, `bookings.test.ts`: rooms not stamped with the reference
  → 5 of 8 failed; the early "already received?" check skipped → the
  switched-off test failed; the race handling removed → the held-race test
  failed with a 500 (and passes with it).

**Shipped — RES-1**
- `api/src/modules/reservations/groups.ts` — the walk-in route's shape (root
  MEMORY 243): the transaction checks the repeat, the channel, and every
  line's room type, fit and price into a plan, and only then writes the
  guest, the group, the rooms and their folios. A marked line —
  *"Nothing below this line refuses"* — divides the two.
- `bookings.test.ts` — five RES-1 tests: each refusal on a booking's SECOND
  line, then the database counted (guests, bookings, groups by name as well,
  folios) — nothing; and the same booking put right goes through whole.
- `DEFECTS.md` (RES-1 to Fixed), `MODULE.md` (the rule, the open items).

**Found — RES-1, reproduced for the first time.** Against the unfixed route
all four refusals answered `409` and kept the guest; the unpriced line, the
room type not here and the party too large each also kept **the first line's
two rooms, confirmed**. Until today RES-1 had only been read.

**Proved — at the end, in this copy**
- `npx tsc -b --force` — clean, exit 0. `cd api; npx tsc --noEmit` — clean.
- `npx vitest run` — **212 passed**, 19 files, exit 0 (no web file changed).
- `cd api; npm test` — **383 passed**, 30 files, exit 0 (370 before + 13).
- `bash db/tests/run.sh` — 636 passed, exit 0 (run after 091; RES-1 changed
  no SQL). `bash db/tests/rerun.sh` — 91 re-runnable, exit 0.
- `npm run build` — built, "✓ no test sign-in in dist", exit 0.
- RES-1's four refusal tests failed on the unfixed route (4 failed, 9 passed)
  and pass with the fix (15 of 15 in `modules/reservations`).

**Left open**
- **RES-2** — not started, as instructed. Both doors switch to the master's
  generator (092) and `FH-<hotel code>-YYMM-<number>` when the master says it
  is ready. Until then two bookings in the same moment can still collide on a
  reference: a 500, nothing kept (RES-1 made that clean).
- **Not in RES-3, and in the same step of the integration plan (1.3):** no
  `channelCode` (PMS-8), the D10 rules for machine callers (stop-sell,
  minimum nights, a price of 0 refused unless complimentary — PMS-6, PMS-7),
  and no ids in the answer (PMS-11). None was asked for here.
- **Nobody can knock on this door as a machine yet**: there is no
  integration key (plan step 1.1), and the server checks no role on writes
  (PMS-2).
- **The desk form sends no key.** A clerk's double-press still makes two
  bookings, as before — though the form greys its button while sending
  (`disabled={saving || …}`, read in `pages/NewBooking.tsx`, not tried).
- The offline zeros and the two search boxes on All bookings (the brief's
  first two items) — paused for this, not started.
- **For the master** (project lessons, not this service's): the local
  Postgres saturated by nine lanes; `db/migrate.sh --with-dev-identities` on
  a fresh database printed a green ✓ under a psql ERROR ("expected 3 staff …
  found 0") and exited 0 — the dev identities need the suite's staff, which a
  lane database built by the brief's command does not have; and
  `pg_stat_activity` is a snapshot inside a transaction.

**Commits:** `2c3c879` (RES-3), and the RES-1 commit that carries this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/reservations/index.ts`, at first mounting
  `api/src/routes/groups.ts`.
- Step 4a (`23cd2e4`): the groups reads came out of `stays.ts` into
  `groups.ts`, in place.
- Step 4 (`51a48c9`), moved into this folder:
  - pages — `GroupPanel.tsx`, `Groups.tsx`, `NewBooking.tsx`,
    `Reservations.tsx` (from `src/pages/`)
  - flow — `GroupRoomsPanel.tsx` (from `src/components/flows/`)
  - data — `groups.ts` (from `src/data/repositories/`)
  - the door gained what front desk uses.
- Step 5, the server (`3424882`): `groups.ts` moved to
  `api/src/modules/reservations/`, and `reservationInserts.test.ts` to
  `api/test/modules/reservations/`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- RES-1 (this folder's `DEFECTS.md`): `POST /:code/bookings` writes the guest,
  and for several rooms the group, before four of its refusals — defect
  243's shape in the booking door. Read in the code while writing the
  brief; not reproduced, not fixed.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- RES-1.
- The groups list, `GET /:code/groups`, stayed in front desk's `stays.ts`
  through the split; whether it should move here is not settled.

**Commits:** `e9dd6b1`, `23cd2e4`, `51a48c9`, `3424882`, and the commit that
adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
