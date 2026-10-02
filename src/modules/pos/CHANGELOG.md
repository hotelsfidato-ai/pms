# Changelog — the restaurant (POS)

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-02 · A paid-out from the tin waits for a yes (the owner's D27-242) - the cash lane's

**Asked for:** the master, with the owner's answer: every cash paid-out needs
the GM's or the owner's approval - an outlet's tin as the desk's drawer.
**Shipped:** `till.ts`: a paid-out raises a `cash_expense` approval ("<outlet>
tin: <reason>"); the day's expected cash leaves it out until approved
(finance's migration 187, `app.cash_expense_counts`); the day end returns
`cash.waiting` and the close asks a reason only for what the waiting
paid-outs do not explain. Close restaurant day shows "Waiting for a yes" by
the line and in the sums.
**Proved:** finance's `cashExpenses.test.ts`, the tin case (recorded by the GM
- reception's till is a per-hotel switch - approved by the owner).
`till.test.ts`'s "moves the expectation when money goes in and out" failed on
the new rule (500 against 200: the paid-out no longer comes off at once); it
now expects +500 in Expected and +300 waiting. `test/modules/pos` before
that change: 23 files, 224 of 225. Screen: ₹150 for vegetables "Waiting for a
yes - not taken off the tin yet", Expected unchanged; 375 px, no sideways
scroll.
**Left open:** nothing here.

---

## 2026-10-01 · A table at the restaurant, from the guest's page (D27-221, D27-223, D27-224, D27-225)

**Asked for:** section D of `docs/briefs/guest-in-stay-plan.md`. The owner answered Q1–Q5 as recommended:
- the last seating is half an hour before each meal ends;
- a guest may book before arrival (confirmed or checked in), any night of the stay;
- the till's people answer, and the owner, admin and GM set the hours;
- an empty meal is off;
- the guest sees the time and the party, not the table.

Also the voucher's Instagram QR (D27-223). Branch `pos/table-booking-1oct`, under the POS lane's claim; cp6 merged in (step 0 `1befb5a4`, quick taps `5fc3b20a`).

**Shipped:**
- Migration 172 (written as 173; renumbered by the master at merge):
  - `pos_outlets.table_lunch / table_dinner`: NULL means the default (12:30-15:00, 19:30-23:00), `''` means not offered.
  - `app.table_slots`: the one definition of a day's slots, in the hotel's zone.
  - The `table_bookings` table: one hotel per booking by trigger, a reason required on a decline, RLS, audit.
  - The guest's four definers, each starting from `app.guest_unlocked`.
- The staff side:
  - `tableBookings.ts` holds the list, Confirm (a table if known) and Decline (a reason), only while the request waits, plus the hours.
  - The Table bookings screen shows Waiting, Today and Upcoming, by the hotel's today.
  - The hours are set on Restaurant setup.
  - The bell says "N table bookings waiting".
  - roleGate: TABLE_ANSWER and TABLE_HOURS.
- The guest side, by online check-in's rule 8:
  - `api/src/routes/guestTables.ts`, with one mount line in `guestDoor.ts`.
  - `online-checkin/TableBooking.tsx`, with one line in `Behind`. It hides when it has nothing.
  - `at` and `withUnlock` are exported from `guestPage.ts`.
- The voucher's QR: `instagramLink` (a handle, or a URL as typed), drawn beside the Instagram address, with "Scan to connect".

**Found:**
- `pos` (the waiter) has no bell: the matrix gives it no notification. The waiter reads the screen.
- `finance` can ring up an order, so it also sees the answer buttons.
- The answer dialog wrote the date as `2026-10-03`. It now matches the card ("Sat, 3 Oct").

**Proved:**
- API, one file at a time:
  - `tableBookings` 16. The two guest-route cases fail with the route's 409s switched off.
  - `roleGate` 65. The two guest POSTs are added to the person-less-doors pin; the test failed before they were added.
  - `notifications` 2, `guestDoorBehindTheCode` 32, `voucherDocument` 33 (2 fail with the QR forced off).
  - strip-check: 175 files load. api `tsc` exit 0.
- Database: every assertion passes. With the offer switched to `guest_link_stay`, "the link alone" and "another stay's unlock" fail (OCI-5).
- Web:
  - `pos/tableBookings.test.tsx` 5; "today" is the hotel's, and that test fails with the device's day.
  - `online-checkin/tableBooking.test.tsx` 5.
  - `online-checkin`, `pos`, `components/app`, `App`, `src/test`: 205 of 206. The one failure is migrationNumbers: 173 leaves a gap, and 171/172 are other lanes'.
  - web `tsc` exit 0.
- **Opened, 1 October, on `fidato_s45` (migrated to 173):** a made-up stay `TBSCREEN-1` (2–5 Oct), its link unlocked with a code set in the database (sending is not set up locally). The pane was hidden, so buttons were pressed with `element.click()`; the app's own handlers ran.
  - Guest at 375: Fri–Sun nights, twelve slots 12:30 pm – 10:30 pm, no sideways scroll. Sat 3 Oct, 8:00 pm, 4 people, a note: "Waiting for the restaurant" with Cancel. Stored as 3 Oct 20:00 IST.
  - Staff at 1280 x 800 as the GM: the request under Waiting. Confirmed on AC2, it moved to Upcoming with "Table AC2 · by Test GM".
  - Staff at 375: the same, no sideways scroll.
  - The guest's read then said `confirmed`, with no table in it.

**Left open:**
- A booking before arrival shows "room -" on the card (the dash rule). Dropping "room" when there is none is the owner's call.
- The made-up stay `TBSCREEN-1` stays on `fidato_s45`.

## 2026-10-01 · In-room dining from the menu (D27-224, D27-225; the in-stay plan, A)

**Asked for:** a checked-in guest orders from the restaurant's menu on their own page. The order is a SUBMISSION; whoever rings the till accepts it on the Terminal (a room-service order, sent) or declines it with a reason the guest reads. The owner's answers (D27-224):
- prices with "GST added on your bill";
- charged to the room at delivery;
- off while the restaurant or its day is closed;
- no alcohol.
The master's approvals Q1-Q6 (1 Oct):
- the guest's price is kept, and Accept is refused, naming the dish, if it moved;
- the waiter's pop-up, with no per-dish note;
- one note for the order;
- "Room 201" is the stay's room now;
- the five conditions, checked again at Accept;
- TILL accepts, and there is a bell.
Built on step 0's kits (online-checkin MODULE.md rule 8). Branch `pos/room-dining-1oct` from cp6 `1befb5a`.
**Shipped:**
- Migration "in-room dining" (171 for now):
  - `guest_food_orders` (RLS, checks);
  - `app.guest_dining_outlet` (the five conditions);
  - `app.guest_dish_price`, the one price rule: the first choice, plus the further ones, plus the sides, as the till prices it. It is null when the dish is off, taken off the card, alcohol, without a GST rate, or a choice does not belong;
  - the four definers behind the code: `guest_menu`, `guest_food_order_make` (1 to 30 lines, 1 to 20 of each, three waiting at most, a note of 200 at most, each line priced here), `guest_food_orders_mine`, `guest_food_order_cancel`.
- Server:
  - `api/src/routes/guestDining.ts`, mounted with one line in `guestDoor.ts`.
  - `till.ts`: the batch route's `guestOrderId`. The round is the stored basket, priced again; a moved price or a dish gone off refuses the Accept, naming it, and nothing is written. It opens a room_service order for the stay's room, with the note on the first dish, and sends it. The guest order is accepted only `where status = 'waiting'`, otherwise everything rolls back.
  - `GET /till/guest-orders`, `POST /till/guest-orders/:id/decline`, with their roleGate lines (TILL_READ, TILL) pinned. The guest door's pinned writes gain the two new ones.
  - `notifications.ts`: the bell, for whoever may ring the till.
- Screens:
  - online-checkin `RoomDining.tsx`, one line in `Behind`: the menu, a basket where the same dish joins one line, one note, the total with "GST added on your bill", the guest's orders with Take it back. It hides itself when there is nothing to show.
  - `pos/components/GuestOrders.tsx` on the Terminal: "Room-service orders waiting", Accept and send, and Decline (asks why).
  - `DishDialog`'s `guest` hides the per-dish note; pos/index.ts exports it and `MenuItem`; online-checkin's `data/guestPage.ts` exports `at` and `withUnlock` for the feature's data file.
**Proved:**
- Database: "room dining" 17/17, all 1,356 assertions. With the menu keyed on the link alone and no alcohol filter, 4 fail: OCI-5, another stay's unlock, no alcohol, a beer ordered.
- API, one file at a time:
  - `roomDining` 6; 5 of them fail on step 0's `till.ts` (accept, a second accept, a price changed, a dish off, a cancelled order).
  - `roleGate` 65 (the guest door's list pinned), `notifications` 2, `guestDoor` 28, `till` 84, `tillBatch` 5.
  - strip-check: 174 files load.
- Web: `online-checkin/roomDining.test.tsx` 3 (the no-per-dish-note one fails on step 0's pop-up) and `pos/guestOrders.test.tsx` 2. pos + online-checkin + guards: 25 files, 184 passed. Both tsc clean.
- **Opened, 1 October, on `fidato_s46` at 171** (migrated after the master's check for other builds). The pane was hidden for most of it, so the screens were read from the page, and the later taps were script clicks on the page's own buttons.
  - The guest at 375 on a stay in room 201: the menu by section, a dash for dishes sold by their choices, no sideways scroll. Two real taps on Cold Coffee made one line of 2. Paneer Tikka's pop-up had no note section. Large + Extra hot, a note and Order: the total read ₹1,100 (2 x 160 + 280 + 500), then "Waiting for the restaurant · Take it back".
  - The Terminal at 768 as the GM: "Room-service orders waiting · Room 201 · ₹1,100", the dishes and "Please knock softly". Accept and send opened order 20260825-7 for "Room 201": Cold Coffee 2 x 160, Veg Manchurian 280, Paneer Tikka (Large, Extra hot) 500, all sent (KOT 6). The guest order was accepted.
  - The Kitchen at 1280: the three dishes under "ROOM 201 · 20260825-7".
**Left open:** the guest page's screenshots (the pane was hidden; the page was read instead).

## 2026-10-01 · The kitchen has two buttons; Ready goes to the waiter (D27-221, D27-222)

**Asked for:** the owner's D27-221, before the launch. The Kitchen screen has two buttons, Start and Ready, and a ready dish leaves it and shows as "Ready" to the waiter on Tables and the Terminal. D27-222 answered the plan's questions:
- the waiter taps "Taken": beside each Ready dish on the Terminal, and once on the table's "2 ready" badge for all of them;
- the kitchen's route takes preparing and ready only;
- no waiting clock on the waiter's side.
Branch `pos/kitchen-two-1oct` from cp6 `022e14e`, cp6 `7ada298` merged in; `fidato_s46` migrated to 170 with the master's OK.
**Shipped:**
- `till.ts`:
  - The kitchen read holds sent and preparing only. POS-1 now keeps paid food until it is Ready.
  - The at-the-pass clock (and its `app.pos_line_timings` call) went with the third column.
  - The kitchen's move takes preparing and ready ("The kitchen starts a dish or makes it ready.").
  - The floor read gives each table its ready dishes: `ready`, a count of dishes (quantity, sides not counted), and `readyIds`.
  - `POST /till/orders/:id/taken {lineIds}` serves Ready dishes only, all checked before the write, and says why otherwise ("… is not ready yet - the kitchen says when it is", "… is already taken"). It works on a settled order too (151 lets the kitchen status move).
- `roleGate.ts`: the Taken line is TILL (the waiter's), pinned in `roleGate.test.ts`: the waiter may, the chef may not.
- Screens:
  - Kitchen: two columns, Ordered and On the fire; By table has no "Done" fallback; a ticket is judged on its wait.
  - Terminal: a Ready dish reads "Ready" (green) with a Taken button.
  - Tables: "N ready" in green on the table's tile, a row of its own (POS-31), one tap for all.
**What was lost:** the kitchen's at-the-pass clock. Nothing else read it: no report or lateness screen uses `app.pos_line_timings` or `app.pos_line_lateness`. 080 still records every status change, and Taken is the served time, so ready → served stays in the timings for anyone who asks later.
**Proved:**
- API, one file at a time: `kitchenTwo` 3 (new); `kitchenTimings` 4 and `restaurantFixes` 12 (one case each rewritten). All 5 new or rewritten cases fail on cp6's `till.ts` and `roleGate.ts`. Also `roleGate` 63, `till` 84, `tillBatch` 5, `courses` 3, `prepTimes` 5, `kotStation` 3 and `sameDish` 4. strip-check: 169 files load.
- Web: `kitchenTwo.test.tsx` 3; all 3 fail on cp6's screens. `src/modules/pos` + `src/test` + primaryAction + repositories + navigation: 20 files, 129 passed.
- `npx tsc -b --force` exit 0; api `tsc --noEmit` exit 0, both after merging cp6.
- The database suite's timing and course checks are unchanged (no database change); the master runs the suite in the full gates.
- **Opened, 1 October, on `fidato_s46`:**
  - Kitchen at 1280 x 800, as the Kitchen Manager: "Ordered 13" and "On the fire 2", two columns of 640px, no "Picked up". Ready on AC2's Masala Chai took it off the board. By table showed 13 Start and 1 Ready, and no Done.
  - Tables at 1280 x 800, as the GM: "7 ready" on AC1 (the demo's old at-the-pass food) and "2 ready" on AC2. A real tap on AC2's badge cleared it and opened no pad; the database then read Masala Chai and Chicken 65 served, Veg Manchurian still preparing.
  - Tables on a 375 phone: "7 ready" on one line, 136 x 44, no sideways scroll.
  - Terminal at 768 x 1025 on AC1's DH-001: four Ready dishes, each with Taken; a real tap on Veg Manchurian's turned it to "served".
**Left open:** the Till's bill shows no kitchen status (not asked for, D27-221 names Tables and the Terminal).

---

## 2026-09-30 · D27-189 part 2: a dish's variation types on one form (D27-192, D27-195)

**Asked for:** the owner's D27-189 and their answers of 30 September (D27-192, D27-195). "Add variation" is a simple form: pick a type, Size, Quantity or Option (an Option headed by the manager, "Spice level"); list its choices, each with a price or Free. A dish may have SEVERAL types, each a required single choice. The first type carries the full price; each further type's choices add +₹ or are Free. The same name may be in two types. Add-ons stay the Add-on groups, with the Free tick. A 0 is refused unless ticked Free (D27-120 replaces D21-42). The waiter picks in one pop-up. A carried-over dish sells as "Variation" until its type is picked. The master approved the model before any of it was written. The owner stopped work mid-way; it resumed after merging cp6 (rates 162, cash 163).
**Shipped:**
- Migration 164, "several variation types per dish" (written as 182, renumbered at the master's word). `pos_item_variations` gains `type_no` (default 1), `kind` and `heading`, with a check. A name is unique within its type, `(item_id, type_no, label)`. `pos_order_lines` gains `extra_choice_ids`. 045's trigger now asks one choice of every type, all of this dish. The defaults carry every existing variation, the menu import and the demo loader over as "type 1, not picked". The two `on conflict` lines (`till.ts` import, `api/scripts/load-demo.ts`) name the new key.
- `till.ts`:
  - One `PUT /till/menu/items/:id/variations` saves the whole set in one transaction. A choice keeps its row by type and name (a removed one comes back), else by its id; one left out is switched off; emptying the set asks for the dish's price. The three per-variation routes, their data functions and their `roleGate.ts` lines are gone.
  - `addOneLine` takes `moreChoiceIds`: one per further type. The price is the first choice plus the others, worked in paise; the name reads every choice ("Paneer Tikka (Large, Extra hot)"); the match includes them. A + on a sent dish carries them.
  - Add-on options take `free`; the add-ons file refuses 0.
  - "No price" now says "Type a price, or tick Free."
- Screens:
  - Menu: the form ("Add variation" / "Change variations"). Type buttons; Heading for an Option; names filled in, never prices; "Price" on the first type, "Adds" on the others; Free on each choice; "Remove type" (the next one's figures cleared, to be typed again as the price); "Add another type". Under the dish, one line per type. An add-on option has Free, and a ₹0 one reads "Free".
  - The pop-up: a row per type under its heading; "+₹20" / "Free"; Add waits for one of each; with two or more types it says "Choose one of each, and any sides."
  - `pricing.ts` (`typesOf`, `headingOf`, the added price); the pad keeps `moreChoiceIds` (`src/lib/draft.ts`, one optional field, the master's yes).
**Proved:**
- Database (before the merge, on the branch): `db/tests/run.sh`, all 1,280 assertions. "pos variation types" 8/8, and 3 of them fail with the trigger section taken out. `db/tests/rerun.sh`: 162 migrations re-runnable. After the merge the master runs both in the full gates.
- `fidato_s46` migrated to 164 with the master's OK: 116 → 118 tables. The demo's two variations came over as type 1, not picked.
- API, each file on its own after the merge:
  - `padTotal` 4, including the new two-type case: the pad's ₹480 agrees with the bill.
  - `variationTypes` 5; all 5 fail on the pre-PUT `till.ts`.
  - `menuOptions` 8, `sameDish` 4, `restaurantFixes` 12, `till` 84.
  - `tillBatch` 5; `roleGate` 63, with the PUT pinned to the kitchen manager and the menu-route floor at 23 (three routes became one).
  - strip-check: 165 files load.
- Web: `variationTypes.test.tsx` 2 and `ownerDecisions.test.tsx` 22; the 6 new ones fail on the pre-form client. `src/modules/pos` + `src/test` + primaryAction + repositories + navigation: 125 passed, migration numbers included. `npx tsc -b --force` exit 0; api `tsc --noEmit` exit 0.
- **Opened, 30 September, as the GM on `fidato_s46`:**
  - Menu: Bhaaji Pau read "Variation: Oil ₹300.00 · Butter ₹400.00". Its form said "Pick Size, Quantity or Option. It sells as "Variation" until you do", with Save off. Option kept the names and asked for a Heading; "Cooked in" saved, and the dish then read "Cooked in: Oil ₹300.00 · Butter ₹400.00".
  - Paneer Tikka: Size filled in Small / Medium / Large with blank prices and Save off. It was made Regular ₹320 / Large ₹480, plus an Option "Spice level": Regular ticked Free (the same name as in Size) and Extra hot 20. It saved and read "Size: Regular ₹320.00 · Large ₹480.00", "Spice level: Regular Free · Extra hot +₹20.00", with "-" for its own price.
  - Tables, AC7: the pop-up showed Size and Spice level rows, "+₹20" and "Free". Large alone was ₹480 with Add off; with Extra hot, ₹500. Two of the same read one line, "Large, Extra hot · 2 · ₹1,000". Large with a Regular spice was its own line. Sent as KOT 5; the Kitchen screen read "2 × Paneer Tikka (Large, Extra hot)" and "1 × Paneer Tikka (Large, Regular)".
  - The docket: this tab was switched on as the KOT station, with `window.print` recorded. The reprint of KOT 5 put on the paper "KOT - 5 · Dine In · Table No: AC7 · Paneer Tikka (Large, Extra hot) 2 · Paneer Tikka (Large, Regular) 1", with no prices. The station was switched off again.
  - The Till (a new order, Lane T2): the same choices twice read "2× Paneer Tikka (Large, Extra hot) ₹1,000".
  - The Terminal at 768 x 1025, AC7: + on the sent "Paneer Tikka (Large, Extra hot)" made one unsent line of 1 (₹500) with the spice carried; + again made it 2; the tile's pop-up with the same choices made it 3 (₹1,500).
  - Some adds (the second on Tables, the Till's two, the Terminal's tile) were driven by script clicks on the page's own buttons, because the pane's viewport kept jumping. The rest were real clicks.
**Left open:** the menu import cannot carry a second type (not asked for).

## 2026-09-30 · D27-189 part 1: the same dish tapped again is one more of it (POS-27, POS-28)

**Asked for:** the owner's D27-189, with their answers of 30 September (D27-192, Q7 and Q8). An unsent dish tapped again adds to its quantity, and it has a − to reduce it. Once the kitchen has a dish, more of it is a new line for the next KOT (D27-148). A dish with a variation or sides is the same only when its choices are the same. Branch `pos/tap-variations-30sep` from cp6 `c01b150`, copy `.claude\worktrees\admiring-goldstine-34db29`, database `fidato_s46`, API 8905, web 5305.
**Found:** reproduced on all three screens first. The full account is in DEFECTS POS-27 and POS-28:
- Tables' pad appended every tap.
- `addOneLine` started a new line for any dish with sides.
- The Terminal's + on a sent dish made a new line on every press.
- The Till had no −.
- A dish's quantity changed without its sides.
**Shipped:**
- `till.ts`: `addOneLine` matches the variation, the note and the same set of sides, on unsent lines only, and raises the dish and its sides together. The quantity route's "more of a sent dish" calls `addOneLine`, which copies the sides; its own insert and its refusal for a dish with sides are gone. Setting a quantity sets the sides too.
- `OrderPad.tsx` `put()` joins the same dish.
- The Till: a − beside each dish; a sent dish asks for a manager's reason.
- The Terminal: a side sits under its dish, with no −/+ of its own.
**Proved:**
- API `sameDish.test.ts`: 4 passed, and 4 failed on cp6's `till.ts`. `restaurantFixes` 12, `till` 84, `tillBatch` 5 and `padTotal` 3 passed, each file run on its own.
- Web `sameDish.test.tsx`: 4 passed, and 4 failed on cp6's three screens. `src/modules/pos` + `src/test` + primaryAction + repositories: 17 files, 104 passed.
- `npx tsc -b --force` exit 0; api `tsc --noEmit` exit 0; strip-check: 163 files load.
- **Opened, 30 September:**
  - Tables, AC6: three taps read "Butter Roti 3, Rs 120". Bhaaji Pau (Butter) + Onions twice read one line of 2. The second of those two was added by a script click on the pop-up's buttons, because the dialog sat mid-animation. Sent, KOT 4 held Butter Roti 3, Dal Tadka 3, and Bhaaji Pau (Butter) 2 with Onions 2.
  - The Till, order 20260825-3: − took Butter Roti from 2 to 1. The same Bhaaji Pau choices joined the first line, giving "2× Bhaaji Pau (Butter)" and "2× Sides: Onions".
  - The Terminal at tablet width (768 x 1024), AC6 all sent: two presses of + on Butter Roti gave one new "Butter Roti 2". + on Bhaaji Pau gave a new Bhaaji Pau (Butter) 1 with its Onions 1. The sides had no −/+.
**Left open:** part 2, the variation form - done the same day, the entry above.

---

## 2026-09-30 · The cash lane, second round: the outlet's day opens by itself (D27-200, D27-201)

**Asked for:** the owner's D27-200, which replaces the daily "Open the day" of the entry below. The day-end hunks and the settle check's condition only.
**Shipped:** `app.pos_opening_cash` (165): the day's own row, else the float kept at the outlet's most recent close that kept one, however many days back; null only on the first-ever day. `app.pos_expected_cash` reads it. GET day-end shows it (`opened` = not null); Settle refuses cash only when it is null; the night count writes the day's row with it (it refused "Open the day first"); `POST /till/day-end/open` is for the first-ever day and refuses once a float carries. Nothing is written for a day until its night count. `DayEnd.tsx`: the Open card shows only on that first day; its words.
**Proved:** `cashCounts.test.ts`: five days after a close that kept 800 the day is open with nothing pressed, takes cash, expects 800 + the bill, refuses day-end/open, and the count writes 800 down; failed with the carry taken out of the function. POS folder run with the rest (finance's entry). On screen: no Open card, float ₹1,000 from 24 Aug's close, expected ₹1,336.
**Left open:** an expense paid from the tin on a day with no sale and no close shows as a difference at the next close (the owner's yes, D27-201).
**Commits:** 45c21be9.

---

## 2026-09-30 · The cash lane: Open the day, no cash before it, the float kept at the close (D27-190, D27-191, POS-29)

**Asked for:** the owner's D27-190 at each restaurant outlet, which replaces D27-139's "no open step" (D27-191); the master's yes for the day-end routes and the one cash-tender refusal only, away from the order pad the POS lane works on. Branch `cash/counts-deposits-30sep`; finance's own entry has the whole of it.
**Shipped:**
- `POST /till/day-end/open` (roleGate DAY_END, pinned): the float counted once; a blank float refused. `GET /till/day-end` says `opened`.
- Settle refuses CASH (and a split with cash) until the outlet's day is open, after the function and delivery refusals; bills, card, UPI and room charges go on.
- The night count needs the opened day, no longer takes or defaults the float, and refuses a closed day in words (it gave a 500).
- The close asks `keptCash`, the float kept for the next day (0 to counted); `pos_day_ends.kept_cash` (migration 163).
- `pages/DayEnd.tsx`: an "Open the day" card on the note grid; the count step's float field gone (read-only in the sum, a dash until opened); Finalize asks the float kept and shows To deposit. `data/till.ts`: `openDay`, `opened`, `keptCash`.
- Tests that take cash at the till open the outlet's day first (`openTillDay` in `api/test/drawer.ts`): till, cashLimit, settleTwice, restaurantFixes (NA-2), finance's alcoholVat (D22-44), reports (one test); web fixtures carry `opened`.
**Proved:** see finance's entry - `cashCounts.test.ts` guards seen failing without them; POS folder 18 files 190 passed; the screen walked on `fidato_s47`.
**Left open:** the page still serves one outlet (REST). "To the safe" before the day is opened is not refused (not in the master's yes).
**Commits:** 0cadb22, c9ba2b4, and the next.

---

## 2026-09-29 · The folio lane: "Charge to room" on a room with two open bills (POS-26, D27-162)

**Asked for:** the owner's bug of 28 September (a POS charge to a room not on the guest's bill) - root cause, fixed once, one test. Branch `folio/edit-29sep` (from cp6 ca02e37, round F's `fix/leftovers-28sep` merged in), copy `.claude\worktrees\nervous-spence-42dcae`, database `fidato_s31`, API 8871, web 5271.
**Found:** read-only on the master's `fidato`: the owner's order was still open, nothing from the till had ever reached a bill, and the telemetry held one settle answering 409. Room 201 held two checked-in stays; the confirm closed on "yes" and the server's "which of the two?" came back as two small lines under the total. Reproduced on `fidato_s31`. Nothing in the posting code was wrong - it was never reached. Full text: DEFECTS POS-26 (POS-24 went to the KOT lane first; my commits say POS-24).
**Shipped:** `roomAsk` (`components/AskDialog.tsx`), used by the Till and the Terminal: one button per open bill in the confirm itself, a company bill named "guest - bill to company"; the server's question or refusal read in the same box (`Reply`). `/till/rooms` and the settle's choices carry the company (`till.ts`). The two side panels are gone.
**Proved:** `restaurantFixes.test.tsx`, two new cases, both seen to fail on the old screens; web pos 10 files, 75 passed. On screen: the owner's order 20260825-1 settled to Tanvi Bhide and shows on her Bill tab.
**Left open:** a split stay's two GUEST bills (no company) would show one name twice; none exists today.
**Commits:** bb24d07. API `till.test.ts` 84 passed, and 143 with `roleGate.test.ts` after merging cp6 2fac3e8.

---

## 2026-09-29 · One KOT printer per outlet (D27-159, D27-161, D27-167) and the Till's Send to the kitchen (D27-166)

**Asked for:** the owner's D27-159: one device per outlet prints every KOT through its browser (Chrome with `--kiosk-printing`), switched on in Settings by the kitchen manager and admins; no other device prints one; the POS shows the station's status; the station has Reprint; a one-time setup doc. The owner's details, D27-161 (all nine recommendations): the switch in a "KOT printer" panel on the Kitchen screen (the kitchen manager cannot open Administration → Settings); owner, administrator, GM and kitchen manager; a typed name; no fallback, retiring D17-18's slip on every send, POS-10's notice and the docket page; missed KOTs print when the station is back, oldest first, and a station switched on or moved prints from then; the status wording, online = seen within 90 s; the last 20 with Reprint; prints while a restaurant screen is open; 80 mm, the content as today. D27-167: catch up on the business date only. D27-166 (the speed check's W-1): the Terminal's Send to the kitchen on the Till. Branch `pos/kot-station-29sep` from cp6 `7980862`, round F and cp6 merged in; copy `.claude\worktrees\cranky-leakey-4eb5e9`, database `fidato_s33`, API 8875, web 5275.

**How KOTs printed before:** a send on Tables (the order pad) or the Terminal opened `/h/:code/till/orders/:id/kot/:no` in a new tab on the waiter's own device, which printed through the browser's dialog; the Till sent nothing at all (POS-24). Nothing recorded that a docket had printed.

**Shipped:**
- Migration "one KOT printer per outlet" (157): `pos_outlets.kot_station_device / _name / _since / _seen_at` (a device, its typed name and its start together, a check), and `pos_kot_prints` (one row per printed docket; RLS; the app role inserts, never updates or deletes).
- `till.ts`: `GET /till/kot-station`, `POST /till/kot-station/:outlet` (on moves it; off only from the station), `POST /till/kot-station/:outlet/poll` (last seen; the due dockets and the last 20, to the station only), `POST /till/orders/:id/kot/:no/printed` (the claim before the paper). `KOT_STATION_ONLINE` and `CATCH_UP_FROM` are each one named line. `roleGate.ts` (delegated): `KOT_SWITCH` (menu edit), `KOT_PRINT` and `KOT_READ` (the till, the chef, the kitchen manager, `payment`); the docket read widened to the kitchen, which now prints it.
- `components/KotStation.tsx`: the printer (in `PosGate`, so every restaurant screen), claim then `window.print()` with only the slip on the paper, one at a time, asking again on the live channel and every 30 s; the status line on Tables, the Till, the Terminal and the Kitchen; the Kitchen's KOT printer panel (name, "This device prints KOTs", the last 20 with Reprint). `components/DocketSlip.tsx`: the docket's layout, moved from `pages/Docket.tsx`.
- The Till's "Send to the kitchen" (POS-24).
- Retired: the slip on send in `OrderPad.tsx` and `Terminal.tsx`, `SlipNotice.tsx`, `pages/Docket.tsx` and its route.
- `KOT-STATION-SETUP.md`: the owner's one-time setup.

**Found:** POS-24 (the Till never reached the kitchen). POS-25 (mine, caught by its own test: the station asked again at once after a lost claim).

**Proved:**
- API `kotStation.test.ts`: 3 passed. With the business-date bound, the off-only-from-the-station condition and the claim's station check taken out: 3 failed.
- Web `KotStation.test.tsx`: 6 passed. With the claim check taken out: 1 failed.
- `ownerDecisions.test.tsx`: 21 passed. Its new tests are that a send on Tables or the Terminal opens no tab, and the Till's Send.
- `src/modules/pos` + `src/test` + primaryAction + App.test: 110 passed, 1 failed. The failure is `migrationNumbers`, on the gap 157-159, which the master renumbers at merge.
- `npx tsc -b --force` exit 0; `cd api && npx tsc --noEmit` exit 0.
- **Opened, 29 September, 19:38 to 19:50 IST.** `fidato_s33` at 160, API 8875; two devices in the Claude app's browser pane. The station was `localhost:5275`, signed in as the Kitchen Manager. The other device was `localhost:5276`, the same code but a separate origin, so it had its own device id; it was signed in as Reception, then as the GM. `window.print` and `window.open` were replaced in both tabs by a recorder, so no print window blocked the pane; the recorder kept what was on the paper.
  - Before switching on, both devices' lines read "No KOT printer for Fidato Restaurant - KOTs are not printing" in red.
  - Ticking with no name was refused: "Type a name for this device, for example Kitchen PC."
  - With "Kitchen PC" typed, both read "KOT printer: Kitchen PC - online". The six older KOTs showed in the last 20 as "not printed" and did not print.
  - Reprint of KOT 2 put KOT - 2 · Table AC8 · four dishes on the paper, with no price, and wrote nothing to the server.
  - From the other device:
    - Tables (AC3), the Till's new "Send to the kitchen" (N6; the button then read "Kitchen has it all", switched off) and the Terminal (N6) each sent a KOT.
    - The station printed KOT 3, 4 and 5, 1 to 7 seconds after each send, each once, with the dish names, quantities and table.
    - The sending device opened nothing and printed nothing.
  - Reception's panel showed the status only: no switch, no list.
  - The station went to a non-restaurant screen while N5 was sent. After 90 s the other device read "KOT printer Kitchen PC not seen since 7:45 PM - KOTs are not printing". Back on the Kitchen screen, the station printed the missed KOT 6 at once and read online.
  - The GM switched "Till PC" on at the other device. The old station read "KOT printer: Till PC - online", and the next KOT (7) printed on the new one only.
  - `pos_kot_prints` held exactly KOTs 3 to 7, one row each.
  - The only console error from this work was the deliberate 409.

**Left open:**
- Silent printing on a real printer is untested here: the setup doc's step 4 is the owner's test.
- `window.print()` in a minimised window is not guaranteed; the doc says keep it open.
- The last-20 read scans the outlet's lines on every ask (a `ponytail:` note in `till.ts`).

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149), part B: the till's menu entries follow who may ring up (QA RO-4)

**Asked for:** QA RO-4's POS part. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** `nav.ts` `mayRingUp` - the server's own rule for ringing up (roleGate.ts `TILL`: `payment` create, and the till operator). Tables, Till, Terminal and Close restaurant day (plus the kitchen manager) are offered only to them, not to every role that may read the orders; the Kitchen's "Console" link to the till likewise. The Viewer loses the four; the chef loses Console.
**Proved:** web pos + src/test 13 files, 79 passed; navigation + boundaries 22 passed; the sidebars printed per role (read_only: Kitchen only of the four; finance, front desk, pos: all).

---

## 2026-09-28 · Fix round C: the kitchen keeps paid food, a reason to strike sent food, whole-rupee cash, a closed day stays closed

**Asked for:** the owner's D27-116 (every BLOCKS WORK and WRONG RESULT in QA's restaurant and night-audit tables), D27-117 (ask before charging a bill to a room), D27-118 (on the till: the owner's answer 5), D27-119 (who strikes food the kitchen has). Branch `fix/restaurant-audit-28sep` from cp6 `631ce1f`; migration 151 (the master's number).
**The owner's answers (28 September, round C):** 1 the existing roles strike sent food - owner, administrator, GM, hotel manager, kitchen manager - no Captain role; 2 a bill paid wholly in cash is rounded to the rupee, card/UPI/room exact; 3 the same people and a reason for fewer of a sent dish and for Close unpaid once any of the bill was sent; 4 the reason on the docket, the Kitchen screen, Close restaurant day and the night audit; 5 a closed restaurant day refuses new bills and payments until the night audit (no new "open the drawer" step); 6 fix now: more of a dish the kitchen has is a new line.
**Shipped / found / proved / left open:** DEFECTS POS-22. **Commits:** on the branch.

---

## 2026-09-28 · POS-19: the waiters list (`till.ts`, the read only) lists the hotel's people (D27-97)

**Asked for:** the owner's D27-97, through the master: the same fault as housekeeping's HK-14. **Shipped:** the read uses `app.hotel_people` (migration 149), names only; branch `housekeeping/staff-lists-28sep`. **Proved:** `api/test/modules/pos/waitersList.test.ts` failed on the old code (1 failed) and passed on the fix; `cd api && npx tsc --noEmit` exit 0. Full gates: the master's combined run.

---

## 2026-09-27 · D27-9: the owner's paid-in on a GM's Close restaurant day (from the cash and invoice session)

The master gave the owner's D27-9 to the cash and invoice session
(`compliance/cash-invoice-27sep`): the day end's paid-in/out list in `till.ts`
left-joins `staff`, `recordedBy` null where the name is hidden, "-" on
`pages/DayEnd.tsx`. Tests in `api/test/modules/pos/till.test.ts` and
`functionOrders.test.tsx`, each seen failing without the fix. The whole entry
is finance's CHANGELOG of today.

---

## 2026-09-27 · Five bugs in one session (D27-1): two of them the restaurant's

**Asked for:** D27-1 - a GM told "No such order" for an order the group owner
opened; an outside till's void of a bill already reversed at the hotel
answering an error. The owner's answers (27 September): a name the reader may
not see prints "-" ("Served by -"); the void says "Bill {ref} has already been
taken off the guest's bill at the hotel. Nothing to void."

**Shipped:** `readOrder` in `till.ts` left-joins its three staff reads (opened
by, a line's added by, a payment's taken by - MEMORY 283); `openedBy`,
`addedBy`, `takenBy` are `string | null` and `Bill.tsx` and `Terminal.tsx`
print "-". `pos.ts`'s void refuses a bill whose posting already has its
reversal, before any write (was a 500 on 021's one-reversal index). Beside
them, the same session: GUE-2 (guests), the Night audit report's outlet and
order (reports), and `RequireAccess` naming the page by its menu entry.

**Proved** (cp6 188b504 plus the branch): web tsc exit 0; API tsc exit 0; web
81 files, 706 tests, exit 0; API 99 files, 1,566 tests, exit 0; database 1,180
assertions, exit 0; "all 144 migrations are re-runnable", exit 0. Seen failing
with each fix taken out: `till.test.ts` "a GM reads an order the group owner
opened" - each of the three joins put back fails it ("No such order", a
missing dish, a missing payment); `pos.test.ts` "refuses in words a bill the
hotel already took off" - 500 on cp6's `pos.ts`. On screen as the GM: the
owner's order 20260825-2 opens and reads "Served by -".

**Found:** the day end's paid-in and paid-out list (`till.ts`, `join staff s on
s.id = m.recorded_by`) has the same inner join - a movement the owner recorded
is missing from a GM's list. Not fixed: outside D27-1.

**Left open:** that join; `RequireAccess`'s `resource` prop is no longer read
and is still passed by every route.

---

## 2026-09-25 · Restaurant setup: a new hotel's restaurant without the script — D22-6

**Asked for:** D22-6, "a screen to set up a hotel's restaurant till and tables - yes, before the second hotel". Until now the restaurant (the `REST` outlet Tables, the Till and Close restaurant day open) came only from the demo or `npm run pos:outlet`, and sections and tables only from the demo. **The owner's answers** (D25-20 to D25-26): the restaurant's name, its sections and tables, and a ready-to-open list of six ticks; owner, admin and GM only; tables one at a time or a numbered run, seats optional (a dash when blank); taking a table or section away switches it off, refused while a bill is on it; Point of sale → Restaurant setup, last; "Set up tables" on an empty Tables screen for those who may.

**Shipped:** `pages/Setup.tsx` at `/h/:code/till/setup` (RequireAccess + PosGate); `GET /till/setup` and seven writes in `till.ts`, behind the till's gates, on roleGate `TILL_SETUP` (`room_config` edit); `addOutlet` in `pos.ts`, the one way an outlet row is made - the screen makes REST with no key (staff_id the person who set it up), `pos-outlet.ts` uses it for keyed outlets. The "Set up tables" button on `Floor.tsx`. No migration.

**Found:** POS-17 (mine, caught before commit: the list read a kept menu); POS-18 (the shell's: a typed address keeps the sign-in property's role - reported to the master).

**Proved** (tree with cp6 3399768 merged): web tsc exit 0; API tsc exit 0; web 666/666; API 1,478/1,479 - the one, `reports.test.ts` "counts available rooms from the day the property first traded", timed out at 20 s under load and passed 30/30 run alone; database 1,154 assertions; 138 migrations re-runnable. New: `api/test/modules/pos/tillSetup.test.ts` (16: a fresh property with no restaurant set up through the routes, then a first order rung on its table) and `tillSetup.test.tsx` (5). Seen failing with the rule taken out: the busy refusal (1 of 16), the GST tick (1 of 5). `npm run pos:outlet` made a keyed outlet through `addOutlet` and listed it. On screen: a new property SEC set up by the GM (name, A/C run AC1-AC6, Non A/C N1), a dish on Menu, then the waiter rang Dal Tadka on AC1 (order 20260825-1, ₹180 at 5%, sent to the kitchen). Screens: `.local/screenshots/2026-09-25-till-setup/` (01-08, desktop and phone). The waiter was rostered by SQL (adding a person needs Firebase).

**Left open:** POS-18 (the master's). A second outlet and an outside till's key on screen were not chosen.

---

## 2026-09-24 · The heading picker's three questions, answered — D24-10 to D24-12

**Asked for:** the night-audit lane of 24 September put the three questions the
picker left to the owner. **Answers** (`docs/briefs/decisions-2026-09-24.md`):
D24-10 the Menu screen's picker keeps the menu's people (owner, admin, GM,
kitchen manager) and the finance tax card keeps GST's; D24-11 no way to clear a
heading back to "not set"; D24-12 the import note's "- or alcohol, where the
property serves it" stays. **Shipped:** nothing - all three as built.
**Proved:** the Menu screen opened at 5EL as the GM, desktop and phone
(`.local/screenshots/2026-09-24-night-audit/11-menu-heading-picker-*.png`).

---

## 2026-09-23 · A tax-heading picker on each menu section, and Alcohol in the import — D22-4, D22-46

**Asked for:** the owner's D22-4 - "a tax-heading picker on each menu section:
yes" (the add-dish form keeps its 5% choice; "Section's rate" first was not
chosen) - and D22-46: "Alcohol" as a section's heading in the menu import,
only where the hotel serves alcohol. D22-43 (a dish in an Alcohol section with
its own rate stays GST) is as built and untouched. A helper of the master's,
branch `pos/section-heading-picker`.

**Shipped:**
- `api/src/modules/pos/till.ts`
  - `GET /till/menu` sends each section's `taxKind` (null when not set).
  - `POST /till/menu/categories/:id/tax-kind` - restaurant, bar, banquet,
    other, and alcohol only where `app.module_enabled(hotel, 'alcohol')`;
    anything else refused with a sentence. The alcohol question is asked
    before the write (root MEMORY 243). No "not set": nothing asked for one.
  - The import reads the switch once and accepts "Alcohol" (any case) as a
    Tax heading where it is on; where it is off the row is refused: "Alcohol
    is a heading only where this property serves alcohol. The owner or an
    administrator turns it on in Settings, under Modules." The unknown-heading
    sentence lists alcohol only where it is on.
- `api/src/roleGate.ts` (the core's, as the master asked) - the new route on
  `MENU`: owner, admin, GM, kitchen manager - the same people the import
  already lets set a heading. The tax card's own picker stays `GST`.
- `src/modules/pos/pages/Menu.tsx` - a select in each section card's header,
  after Course and Prep, in the tax card's words (Restaurant, Bar, Banquet,
  Alcohol (VAT), Everything else). Alcohol is offered only where the
  property serves it (the sidebar's own `getModules` read); a section already
  Alcohol at a property that stopped serving it shows it, disabled; a
  section with none shows "Not set", disabled. The header now wraps, so on a
  phone the picker goes under the name rather than squeezing it.
- `src/modules/pos/data/till.ts` - `SectionHeading`, `MenuCategory.taxKind`
  (optional: a menu cached before today lacks it and reads as not set), and
  `setCategoryTaxKind`.
- `src/lib/importSpec.ts` (the master's) - one sentence in `MENU_SPEC`'s Tax
  heading note: "- or alcohol, where the property serves it".

**Proved:** `api/test/modules/pos/sectionHeading.test.ts` (7) and three tests
in `ownerDecisions.test.tsx` ("the tax heading on each menu section"). Each
was seen failing with its piece taken out: the route's alcohol check and the
import's refusal (`expected 200 to be 409`; the import said "is not a tax
heading" instead of the sentence); the import never accepting alcohol
(`expected 1 to be +0`); the menu read without `taxKind` (6 of 7 failed); the
roleGate row removed (roleGate's "has a rule" named the route, and the
picker's writes got 403 "Nobody has been given this yet"); the screen's
picker not sending, and offering Alcohol regardless (2 failed); never
offering it (the third failed). Numbers in the hand-back. **The screen was
not opened in a browser** (a helper, no browser pane).

**Left open:** who may set a section's heading - asked in the hand-back
(the Menu screen's picker is the menu's grant, the tax card's is GST's, so
the kitchen manager can on one and the accountant on the other).

---

## 2026-09-22 · POS-15: a dish's GST is the rate it is rung at, or a dash — D21-94

**Asked for:** the owner's D21-94 - a dish imported with its GST column blank
read "0%"; "the restaurant is 5%, so a dish never has 'no GST'. Show the rate
its section actually charges, or a dash where none is set." Only what the POS
shows; how tax is computed is unchanged (the finance lane is adding the
alcohol/VAT kind at the same time).

**Shipped:**
- `api/src/modules/pos/till.ts` - `DISH_TAX_RATE`, the one expression for the
  rate a dish is rung at (its own, else its section's rule for its price).
  `addOneLine` uses it as before; `GET /till/menu` now sends it too, and sends
  null, not `Number(null)` = 0, when nothing is set.
- `MenuItem.taxRate` is `number | null`. The Menu row, the Terminal tile and
  the Till tile print "-" for null; a real 0 still reads "0%".
- Looked at and unchanged: the dish dialog, the order pad and the import
  preview show no dish rate; a bill's lines carry the rate copied when rung,
  never null.

**Proved:** `api/test/modules/pos/menuTaxRate.test.ts` (3) - failed before the
server change (`expected +0 to be 5`, `expected +0 to be null`), passes after.
`ownerDecisions.test.tsx` "a dish's GST reads its section's rate, or a dash"
(3) - with the screens' dash removed all three failed on a bare "%", pass with
it. `npx tsc -b --force` 0; `api` `tsc --noEmit` 0; `npx vitest run
src/modules/pos` 55/55; `api` `npm test -- pos` 141/141. **The screens were
not opened in a browser** (a helper chat, no browser pane).

**Left open:** a section created on the Menu screen, or imported with the Tax
heading blank, has no heading - so its dishes with no rate of their own now
read "-" and the till refuses them, which is the truth. Nothing on the Menu
screen sets a section's heading; only a re-import does. And the add-dish form
still sends an explicit rate, 5% preselected. Both asked in the hand-back.

---

## 2026-09-21 · Variations and add-ons on the Menu — D21-40 to D21-45, built on PRODUCTION

**Asked for:** `docs/briefs/pos.md`, the 21 September section, and the owner's
D21-38 to D21-45 and D21-56: an "Add variation" button on each dish (a name
and a price; renamed, repriced, removed); add-on groups made once and offered
on many dishes, saying how many a guest may choose; "Preferences" as options
priced at 0 by a person, never by default; and the menu import carrying
variations and add-on groups. **Built on `79e358e`** (production), not `cp6`,
because it goes live on its own (D21-44, D21-56). No migration: 045's four
tables hold all of it.

**The owner's answers during the job (21 September, asked with a recommendation
each; all five took the recommendation):**
- **The import is two files.** The menu file gains **Variation** (one row per
  variation, each with its price) and **Add-on groups** (names, `;` between);
  a separate **add-ons file** - Group, Option, Price, Choose at least, Choose
  at most - is imported first. Re-importing updates and never removes.
- **The Terminal opens the same dish dialog** as Tables and the Till for a dish
  with variations or add-ons (it could not ring a sized dish at all: the server
  refused "Choose one" and there was nothing to choose with), and the Terminal
  and the Till show **"-"** on a sized dish's tile instead of its own price.
- **Build it "the way Bhaaji Pau works, for the whole menu"** - and for the one
  case that does not cover: **removing a dish's last variation asks for the
  dish's price**, typed, before anything is removed.
- **A blank price is refused for a dish too** (POS-14): a typed 0 is kept.
- **₹0 add-ons print on the guest's bill like any add-on** - no change there.

**Shipped** — branch `pos/menu-variations` from `79e358e`.
- `api/src/modules/pos/till.ts`
  - `typedPrice`: a number or a string holding one, 0 or more - null for a
    blank, a null or a word. Used by the dish route (POS-14) and every new one.
  - Variations: add (a removed one of the same name comes back at the new
    price), rename and reprice, remove (switched off, never deleted - a sold
    line points at it; the last one needs `dishPrice`).
  - Add-on groups: list (with their dishes, including a group on none), make,
    edit (name, choose at least, choose at most - refused if a guest could
    never meet it), which dishes offer it (the whole list; every dish checked
    to be this hotel's first). Options: add, rename and reprice, remove.
  - The menu import reads Variation and Add-on groups: a row without a
    variation for a dish that has them (in the file or on the menu) is refused
    with the reason; an unknown group is refused and says to import the
    add-ons file first. The add-ons file import: a blank price refused ("type 0
    for a preference such as No onion"); a group's rule read from any of its
    rows, a row that disagrees with an earlier one refused by name.
  - `addOneLine` holds a line to the group's rule - and every check on the
    sides now comes BEFORE the dish's line is written (POS-16).
  - **Untouched: the "has no GST rate … Settings → Tax" refusal** (cp6 changed
    that line; the master carries it).
- `src/lib/importSpec.ts` — **MENU_SPEC only** (the master's grant): Variation
  and Add-on groups columns and examples. `importSpec.test.ts`: two tests.
- `src/modules/pos/lib/addonSpec.ts` — ADDON_SPEC, the add-ons file.
- `pages/Menu.tsx` — "Add variation" on each dish; variations under the dish
  with Change and Remove; a sized dish's own price is "-"; an **Add-on groups**
  section (rule, options, Change, Remove, Add option, Dishes); **Import
  add-ons** and **Import the menu**. `EntryDialog`: Save waits for a typed
  price. An empty price box on "Add" is refused (POS-14).
- `flows/DishDialog.tsx` — each group says "choose 1 to 2"; Add waits for a
  required choice; a full group greys the rest.
- `pages/Terminal.tsx` — the dish dialog, and "-" on a sized tile.
  `pages/Till.tsx` — "-" on a sized tile.
- `data/till.ts` — ten calls for the routes above, and `importAddons`.

**Found**
- **POS-14** — an empty price box added a dish at ₹0.00 (`Number("")` is 0),
  on the screen and the server. Fixed on the owner's yes.
- **POS-16** — the single-tap route (Till, Terminal) wrote the dish's line and
  then checked its sides; a refusal after a write is a commit (MEMORY 243), so
  the dish reached the bill without the side the guest chose. Fixed.
- **POS-15, open** — a dish imported with its GST column blank reads "0%" on the
  Menu and the Terminal (`Number(null)`); measured, its section has no heading,
  so it has no rate at all and ringing it is refused. Older than this job.
- The Terminal could not sell a dish with variations (above).

**Proved** — this copy, `fidato_pos_menu`, after the last code edit
- `npx tsc -b --force` exit 0 · `cd api; npx tsc --noEmit` exit 0 ·
  `npm run strip-check` 116 files.
- `npx vitest run` **380 of 380, 43 files, exit 0**.
- `cd api; npm test` **1046 of 1046, 64 files, exit 0** (new:
  `api/test/modules/pos/menuOptions.test.ts`, 8).
- `bash db/tests/run.sh` **all 837 assertions passed, exit 0**.
- `npm run build` exit 0, "no test sign-in in dist (6 files checked)".
- **Guards seen to fail**, each put back and re-run:
  - `typedPrice` reading a blank as 0 → 5 of 8 API tests failed ("price
    undefined: expected 200 to be 409"; the dish, the variation, the option,
    the reprice, the last-variation remove).
  - The group's rule checked after the dish's line is written → "a refused
    dish left a line on the bill: expected 2 to be +0".
  - The rule check removed → "expected 200 to be 409".
  - On the screens (`ownerDecisions.test.tsx`, 21 of 21 before): the Terminal
    without the dialog; its tile with the dish's price; Add not waiting for a
    required choice; a full group not greyed; Save enabled with no price (3
    failed); the last variation removed without a price; the Menu showing a
    sized dish's own price - each failed 1 test by its own name.
- **Opened on screen** (`fidato_pos_menu`, as the owner, API 8797, web 5197):
  Main course, "Chicken Biryani" with an empty price → "Not added", no request
  sent; at 250 → added. "Add variation": Half with no price → Save disabled; Half
  ₹180, Full ₹320 → the dish reads "-", its variations under it. "Choice of
  raita" (choose up to 1: Plain ₹40, Boondi ₹50) on Chicken Biryani AND Veg
  Biryani - "Choice of raita is on 2 dishes". "Preferences": No onion with no
  price → Save disabled; typed 0 → saved; Jain 0; on Chicken Biryani.
  **Tables, AC5**: the pad tile "Chicken Biryani -"; the dialog - Add disabled
  until a variation; Full, Plain then Boondi (Boondi replaced Plain), No onion →
  ₹370; Send → **kitchen slip KOT 2: "Chicken Biryani (Full) 1 · Choice of
  raita: Boondi raita - 1 · Preferences: No onion - 1"**, no prices. In the
  database: 320.00, 50.00, 0.00; net 370.00, tax 18.50, gross 388.50.
  **The Terminal**: tile "Chicken Biryani · 5% · -", tap → the dish dialog;
  Half + Jain → "Chicken Biryani (Half) ₹180.00 · Preferences: Jain ₹0.00",
  total 388.50 → 577.50. **Both imports through the dialog's file box**: the
  add-ons file - 2 new, "Garlic naan" refused for its blank price; the menu
  file - Mutton Rogan Josh Half ₹280 / Full ₹480 with Choice of bread (choose 1
  to 2) and Preferences. At 375px: no sideways scroll, every name 170-180px
  wide; at 1280px every dish row still one 44px line. No console error after a
  marked reload.
  ⚠ The pane was hidden for most of it: dialogs froze mid-animation off-screen
  and screenshots timed out, so the pad, the Terminal and the imports were
  driven with `element.click()` / a file set on the input and read back as
  text; screenshots of the Menu, the groups and the slip were taken at an
  explicit 1280x720.

**Left open**
- **POS-15** (above) - the owner's to say; recommendation: send the resolved
  rate, and a dash where there is none.
- `npm run lane` was not trusted for file counts (it diffs against a frozen
  `origin/cp6`); the real set is `git diff --name-only 79e358e..HEAD`.
- For the master: this branch is on `79e358e`, not `cp6`, and must stay there
  (D21-44) - do not rebase it onto `cp6`. Since `79e358e`, `cp6` changed one
  line in these files: the GST refusal in `till.ts`, untouched here.

**Commits:** see the hand-back.

---

## 2026-09-17 (evening) · D17-21, the till's half — restaurant food on a banquet function's bill

**Asked for:** the owner's D17-21 — *"the POS chat then lets staff attach an
order to one of those functions when ordering (`pos_orders.event_id` exists).
Banquet goes first."* The banquet chat committed its half (`f16a1bd`) during
the day. The owner's answers the same afternoon: **build on banquet's commit**
(its branch alone leaves Rule 2b red until the till calls its door); attach on
**Tables, the Terminal and the Till**; an attached order is **paid on the
function's bill only**, recorded as a new payment **"To a function"**.

**Shipped** — branch `pos/d17-slip-addons-dates`, banquet's `f16a1bd` merged in
(`30a8d3a`).
- `db/migrations/099_pos_settled_to_a_function.sql` — payment method
  `function` on orders and payment rows, and a bill settled to a function must
  name one. Replay-guarded (MEMORY 284). **Number 099 is also the night-audit
  chat's**; the master renumbers at merge.
- `api/src/modules/pos/till.ts` — the order header and the pad's round take
  `eventId`; the server asks banquet's `whyNotAttachable` (its front door)
  before writing, and again before settling to the function; cash, card, UPI, a
  room and a split are refused for an order on a function, with the function's
  name; settling to it writes nothing to a folio; `readOrder` returns
  `eventId` and `eventTitle`.
- `components/FunctionPicker.tsx` — "Banquet function", banquet's list through
  `@/modules/banquet`; not drawn where there is nothing to choose. On Tables'
  pad (sent with the round), the Terminal's order and the Till's order.
- The Terminal and the Till — an order on a function offers **Charge to
  {function}** and shows room, cash, card, UPI (and on the Till, Part)
  switched off with the reason. A settled one reads "On {function}'s bill".
  The printed bill says "Charged to {function}'s bill". Close restaurant day
  lists "To a function", and says it is not in the tin.
- Tests: `api/test/modules/pos/functionOrders.test.ts` (8), `src/modules/pos/
  functionOrders.test.tsx` (8), `db/tests/modules/pos.sql` (new, 8).
- `MODULE.md` (endpoints, the picker, 099, banquet's door under "Leans on",
  the rule), `DEFECTS.md` (POS-13).

**Found**
- **Why the payment question had to be asked:** `app.banquet_event_total` (061)
  counts every settled order on a function whatever its method — cash at the
  till would have been billed to the host as well.
- **POS-13, mine, before commit:** the first database check, with the
  constraint taken out, did not fail by name — its clean-up could not remove a
  settled order's payment and the suite stopped. Rewritten to undo the attempt;
  it now fails by name.

**Proved** — this copy, after the last code edit
- Web: `npx tsc -b --force` exit 0. `npx vitest run` three runs on this tree:
  **302 of 303, exit 1** twice — each time `nightAudit.test.tsx` "sends the day
  it shows" (its one-second wait, the night-audit chat's to fix; alone: 1
  passed, exit 0); and **286 passed, exit 1** once, with `repositories.test.ts`
  failing as a file — its error not captured; alone it passed 17 of 17 (Rule 2b
  included), and it passed in both other runs. **A fourth run, on the
  committed tree (`f671b19`) with this copy's dev servers stopped: 31 files,
  303 tests, exit 0.** `npm run build` clean, "no test sign-in in dist".
- API: `npx tsc --noEmit` exit 0 · strip-check 76 files · `npm test` **42
  files, 773 tests, exit 0**.
- Database: `db/tests/run.sh` **744 assertions, exit 0** (pos function 8 of 8) ·
  `db/tests/rerun.sh` all 99 re-runnable, exit 0.
- Guards against the faults put back: the server's four refusals removed → 4
  of 8 failed (the cash one now on "the order was settled anyway"); six screen
  faults → 7 of 8 failed; the constraint removed → "a bill settled to a function
  with no function is refused | it was allowed". Each restored and green.
- **Opened**, as the owner, API 8795 on `fidato_pos` (banquet switched on there,
  a hall "Lawn", "Sharma wedding" confirmed for 25 August 18:00–23:30):
  Tables AC6 — "Banquet function" offered Sharma wedding, chosen, Paneer
  Butter Masala sent; the order written on the function. The Till — "Charge to
  Sharma wedding" the one primary action, room/cash/card/UPI/Part off, the
  reason; pressed → 200, "Settled today · function · ₹357". Banquet's page for
  Sharma wedding — "Restaurant orders ₹357", "20260825-7 · Settled · Table
  AC6"; total a dash (the hall is unpriced). Database: `pos_amount` 357 once, a
  `function` payment row, no folio posting. Close restaurant day — "To a
  function ₹357". The Terminal — a new order put on the function: the same
  offer and the same switched-off buttons.

**Left open**
- A function chosen on Tables is not kept in the pad's saved draft (the draft's
  shape is the core's); close the pad before Send and the choice goes.
- Settling to a function with the line down gets the shared offline sentence
  "…unless it is charged to a room" (`@/lib/offline.ts`, the core's).
- The Till's list of today's bills reads "· function", as it reads "· cash".
- **For the master:** merge banquet (`f16a1bd`) before this branch — it is in
  this branch already; renumber 099 against night audit's; the root MEMORY
  lessons from POS-8 and POS-13.

**Commits:** the commit that adds this entry.

---

## 2026-09-17 (later) · The owner's four answers: a blocked slip, the Menu on a phone, a table on the slip, how function food is paid

**Asked for:** after `50080a0` the owner answered what that entry left open,
each on the recommendation: **POS-10** — say so when the browser refuses the
slip, with a button, as a notice on the screen (not in the pop-up, which has
no button and is gone in 4.5 seconds); **POS-9** — wrap the Menu's dish rows
on a phone; **POS-12**, found on screen after it — copy the table's name onto
orders taken on Tables, no back-fill; and for **D17-21** — an order attached to
a banquet function is paid on the function's bill only.

**Shipped**
- `components/SlipNotice.tsx` (new), `pages/Floor.tsx`, `pages/Terminal.tsx`,
  `flows/OrderPad.tsx` — a refused slip becomes a line on Tables or the
  Terminal: "Order 4 for AC4 is with the kitchen, but its slip did not open —
  the browser blocked the new tab." · **Open the kitchen slip** · close. One per
  slip; refused again, it says to allow pop-ups.
- `flows/OrderPad.tsx` — the sent round leaves the device BEFORE the slip opens
  (POS-11, below).
- `pages/Menu.tsx` — a dish row's controls go under the name when the row is
  too narrow; unchanged at a desk.
- `api/src/modules/pos/till.ts` — the order pad's route copies the table's
  name into `table_ref`, as opening one order does. **A server change**, the
  batch route only; no migration.
- Tests: `ownerDecisions.test.tsx` 9 → 15; `api/test/modules/pos/tillBatch.test.ts`
  4 → 5.
- `DEFECTS.md` — POS-9, 10 fixed; POS-11 (mine) and POS-12 added and fixed;
  nothing open. `MODULE.md` — the notice, and D17-21's answer.

**Found**
- **POS-11, mine, from `50080a0`:** the slip opened before the pad cleared the
  saved round. In the preview pane the new tab replaced the page, and AC1 read
  "not sent" with a dish already at the kitchen still on its pad — one Send
  from cooking and billing it twice. Fixed; see `DEFECTS.md`.
- **My first POS-11 test passed with the fault put back** — the pad clears an
  empty draft by itself as it opens, and the test counted that. Rewritten; it
  fails on the fault now.
- **POS-12:** the order pad's route never wrote `table_ref`, so every slip,
  bill and Terminal line for an order taken on Tables had no table, since
  8 September.
- **My own slip on screen:** a script that was meant to hand the page its real
  `window.open` back handed it nothing, and the notice's button threw "window.open
  is not a function". The test rig's fault, not the screen's; redone on AC4
  with the real one kept.

**Proved** — this copy, after the last code edit, one gate after another
- `npx tsc -b --force` exit 0 · `npx vitest run` **29 files, 284 tests, exit 0**
  · `npm run build` built, "no test sign-in in dist", exit 0.
- `cd api && npx tsc --noEmit` exit 0 · `npm run strip-check` 75 files load ·
  `npm test` **39 files, 757 tests, exit 0**.
- Guards against the faults put back: POS-10 — hand-off, Terminal notice and
  "blocked again" each removed → 3 failed; POS-11 → failed ("expected 'slip
  opened' to be 'draft cleared'"); POS-12 → failed ("expected null to be
  'AC1'"). Each restored and green.
- `db/tests/run.sh`: not run — no database change.
- **Opened**, as the owner, API 8795 on `fidato_pos`, website 5178, the
  browser made to refuse new tabs where needed: Tables AC3 and AC4 (the
  notice; the second refusal's sentence; the button opened slip 4), the
  Terminal order 5 (notice under the header, no page scroll, no console
  error); two sends that replaced the page left no draft and no "not sent";
  AC5 → slip "KOT - 6 · Dine In · Table No: AC5"; the Menu at 375px (names
  171–178px, nothing past the row) and at a desk (one 44px line).

**Left open**
- **D17-21, this service's half** — still waits on banquet's front door. Built
  to the owner's answer when it is ready: an attached order settles "to the
  function" only. The banquet chat should hear the answer (its total rule is
  unchanged by it).
- Orders taken on Tables before the POS-12 fix keep no table name (the owner
  chose no back-fill).
- The Terminal sets no browser-tab title and its page reads "Fidato PMS" —
  the brief's P2, not touched today.

**Commits:** the commit that adds this entry.

---

## 2026-09-17 · The owner's D17-18, D17-19 and D17-20

**Asked for:** the owner's answers of 17 September
(`docs/briefs/decisions-2026-09-17.md`), the three that are the POS chat's —
*"Tables opens the kitchen slip on every send, like the Terminal"* (D17-18,
POS-5); *"on/off switches for add-ons on the Menu screen, like dishes have"*
(D17-19, POS-2); *"Tuesday, 25 August 2026" and the hotel's name with it, the
button included* (D17-20, POS-7). Then, once the banquet chat's front door is
ready, this service's half of D17-21.

**Shipped** — branch `pos/d17-slip-addons-dates`, copy `D:\fidato-pos`,
database `fidato_pos`. No migration, no server change.
- `flows/OrderPad.tsx` — a send the kitchen received opens its slip in a new
  tab, the Terminal's address and the Terminal's way. Nothing for a round on
  the bill alone or a round held on the device.
- `pages/Menu.tsx`, `data/till.ts` — each dish lists its add-ons under it, and
  each add-on has the dish's "Out of stock" control (one `OffControl` for
  both): 2/4/8/24 hours or Tomorrow, then "Off till … — put back". No "Why"
  (nowhere to keep one); a shared group names every dish it goes off on; the
  row wraps on a phone. `takeAddonOff` and `putAddonBack` give the two routes
  their first caller.
- `pages/DayEnd.tsx` — the heading line, the closed line, the toast and the
  button carry the day in words and the hotel's name, looked up by the page's
  own code (the code itself if no name is known). The button is two lines:
  "Close Tuesday, 25 August 2026" over "5 Elements Akkalkot".
- `ownerDecisions.test.tsx` — 9 tests; `readStates.test.tsx` — its day-end
  heading check now expects the hotel first.
- `DEFECTS.md` — POS-2, POS-5 and POS-7 fixed; POS-8 (mine, below), POS-9 and
  POS-10 new. `MODULE.md` — the add-on routes' caller, the docket's openers,
  the tests, the claim command, D17-21's state.

**Found**
- **POS-8, mine, before commit:** the add-on dialog's duration buttons called
  the posting prop directly, so the switch was sent and the dialog never
  closed. The tests passed — they checked only the request. The type check
  caught it; the test now waits for the dialog to close and the menu to reload,
  and fails with the fault put back.
- **On screen, before commit:** the new close button's label was 355px in a
  317px button and ran over both edges; now two lines. And a switched-off
  add-on's "Off till … — put back" squeezed the add-on's name to 0px on a
  phone; the row wraps now.
- **POS-9 (open):** on a phone every DISH row on the Menu screen shows no name
  (0px) and its last buttons sit 77px outside the card — as before today.
- **POS-10 (open):** a send slower than the browser's few seconds of allowed
  pop-ups opens no slip and says nothing — Tables and the Terminal alike.
- **For D17-21:** `app.banquet_event_total` (061) counts every settled order on
  a function whatever the payment method, so an attached order paid in cash at
  the till would be billed to the host too. How an attached order is paid is
  the owner's question, asked in chat.
- **A slip of mine, no harm:** reading a recorded API result I also started
  `npm test` in `api/` with a 5-second limit; the shell was cut off and the
  suite ran on in its own scratch database, which its harness drops on exit.

**Proved** — this copy, 17 September, after the last code edit
- `npx tsc -b --force`: exit 0 (the run before the POS-8 fix: exit 2, three
  errors in `Menu.tsx`).
- `npx vitest run src/modules/pos`: 29 passed, exit 0 (before the last two
  layout edits). Against the old code (the four source files stashed):
  `ownerDecisions.test.tsx` 8 failed — no slip opened, no add-on control, no
  hotel name — and the updated `readStates` check failed; the two "opens
  nothing" checks passed on both, as they must.
- `npx vitest run` (all): 27 files passed, 2 failed — `front-desk.test.tsx` and
  `stayViewStates.test.tsx`, each at ~8.5s while the API suite ran beside it.
  Those two and `nightAudit.test.tsx` (which failed the same way on the first
  run) rerun alone: 3 files, 15 tests, exit 0. **Second full run, final code:
  29 files, 278 tests passed, exit 0.**
- `cd api && npm test`: 39 files passed, exit 0.
- `npm run build`: built, "no test sign-in in dist (6 files checked)", exit 0.
- `db/tests/run.sh`: not run — nothing here touches the database.
- **Opened**, as the owner, API 8795 on `fidato_pos`, website 5178:
  Menu — Onions off for 2 hours (200; dialog closed; toast; "Off till 04:46 pm
  — put back"; `off_until` 16:46 in the database), the waiter's dish dialog on
  Tables showed Onions struck "off today", put back (200, "Onions is back on").
  Tables — AC1, Bhaaji Pau (Oil) with Curd, Send → the slip "KOT - 1", no
  price, order `20260825-1`. Close restaurant day — "5 Elements Akkalkot ·
  Fidato Restaurant · Tuesday, 25 August 2026", Finalize, the two-line button;
  no ISO date anywhere. Measured at a desk and at 375px: nothing over its
  edge, no sideways scroll. No console error after the mark.

**Left open**
- **D17-21, this service's half** — waits on banquet's front door
  (`getAttachableFunctions`, `whyNotAttachable`; being built on
  `banquet/diary-heading`, uncommitted when looked at) and on the owner's
  answer on how an attached order is paid.
- POS-9 and POS-10 — the owner decides; recommendations in `DEFECTS.md`.
- The toast on Tables still says "Kitchen docket 5." where the Terminal says
  "Order 5 is with the kitchen" — not part of D17-18, left as it was.
- For the master: root MEMORY lesson from POS-8 — *a test that checks only the
  request a screen sent passes while the screen never finishes the act.*
- The preview pane reads the master checkout's `launch.json`, so this copy's
  servers were run from a shell; `.claude/launch.json` here holds two local
  entries and is not committed.

**Commits:** the commit that adds this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the Point of sale menu entries and who works
  from each; `routes.tsx` — the nine screen addresses; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/pos/index.ts`, which mounts the till, the
  person side of the bridge and `/api/pos`.
- Step 4a (`23cd2e4`): `posBridge.ts` cut out of the shared `billing.ts` data
  file; the import report type left `till.ts` for the core
  (`src/data/repositories/importReport.ts`).
- Step 4 (`c2dd9d5`): moved in — pages Bill, DayEnd, Docket, Floor, Kitchen,
  Menu, Pos, Terminal, Till (from `src/pages/`); flows DishDialog,
  OrderHeaderPanel, OrderPad (from `src/components/flows/`);
  `components/PosGate.tsx` (from `src/components/app/`); `data/till.ts` and
  `data/posBridge.ts` (from `src/data/repositories/`); `lib/pricing.ts` (from
  `src/lib/`). The shared data index stopped re-exporting them.
- `3cd6f51`: `api/test/padTotal.test.ts` prices lines with
  `@/modules/pos/lib/pricing` directly — a server test must not load the
  restaurant's screens through its door.
- This brief: `MODULE.md` rewritten from the code — nine screens, 51
  endpoints, the tables and migrations, the owner's rules, open items; this
  file; `DEFECTS.md` indexing 42 root entries.

**Found** (while writing the brief; nothing numbered here)
- Nothing in the till sets `pos_orders.event_id`, so a bill cannot be charged
  to a banquet function — recorded as banquet `DEFECTS.md` BQ-1.
- Bill, Docket, Kitchen and Terminal set no browser-tab title; the two add-on
  on/off endpoints have no caller; `pages/Pos.tsx` draws two page headings
  (details in `MODULE.md`, Open items).

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored), so
  the session signs itself out — and the same 31 failed with the brief-only
  folders taken out. Every run also reports 2 unhandled rejections from
  `src/lib/outbox.ts` under jsdom, with or without these changes.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database. The move commits record their own
  gates in their messages (web types clean, 204 tests).

**Left open**
- The server code is still in `api/src/routes/till.ts` (3,555 lines) and
  `api/src/routes/pos.ts`; moving it into `api/src/modules/pos/` is step 5,
  in progress elsewhere. Splitting the till into parts is not done.
- Tests still live in `api/test/` and `src/App.test.tsx` (step 7);
  `db/tests/modules/pos.sql` does not exist yet.
- The root `CHANGELOG.md` and `HANDOVER.md` were not touched by this brief —
  the core owner's to update.

**Commits:** `e9dd6b1` · `23cd2e4` · `c2dd9d5` · `3cd6f51`, and the commit that
added this file.

---

## Before the move — entries in the root CHANGELOG.md

The restaurant's earlier work is recorded there. Read these entries in the
root file; the bodies are not copied here.

- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (review) · An audit, a security review, and an account takeover closed
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box
- 2026-09-08 (deploy) · Live, and four faults on the way there
- 2026-09-08 (night) · Course sequence and the pass by table — Stage C5
- 2026-09-08 (night) · Timing capture — Stage C3
- 2026-09-08 (late) · Preparation times — Stage C2
- 2026-09-08 (evening) · A room charge with the line down
- 2026-09-08 (later) · The order pad — Stage C4
- 2026-09-08 · Deploy to production, then Stage C

Before 8 September the root file has no entries: `git log`, `PROGRESS.md`
and `POS-PROGRESS.md` are the record.
