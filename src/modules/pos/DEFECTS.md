# Defects — the restaurant (POS)

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `POS-1`, `POS-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### POS-35 · The Roles screen does not show what a waiter or the bar may do in the restaurant - OPEN, found 14 October (D27-324)

**Found** — building the Bar role. The Roles and permissions screen draws the matrix
(`api/src/permissions.ts`) and nothing else. The restaurant's rights are not in it: the
waiter (`pos`), now the bar too, the chef and the kitchen manager get the till, the KOTs, the
pass and the day end BY NAME in `api/src/roleGate.ts` (`TILL`, `DAY_END`, `KOT_PRINT`,
`PASS` and their reads), because the matrix has no restaurant resource. So the screen shows
the Waiter and the Bar with "View" on Reservations and Room availability and a dash on
Payments - while both take payment. Same shape as the GM's Users cell the owner raised
(D27-324 (5), fixed in the matrix), but here the fix is not one grant: giving `pos` and
`bar` `payment` create would also open every other `payment` door (the desk's cashiering).

**Fix waiting** — the owner's call (asked in the D27-324 report): a line under the matrix
naming the restaurant roles' rights, or a restaurant resource in the matrix (a larger change
across roleGate, the menus and the tests).

### POS-18 · A typed address kept the role of the property chosen at sign-in — FIXED 26 September (the shell's)

**Found** — 25 September, proving Restaurant setup end to end. The Reception test sign-in was rostered as a Waiter (`pos`) at a second property and opened `/h/SEC/floor` by its address: the page was that property's (the tab read "Tables · Second Hotel (test)"), but the sidebar was Reception's and Restaurant setup refused them "signed in as Reception". `PropertyScope` sets the property in view (`useUi.hotelId`, the code), while `useRole` reads `useSession.hotelId`, the property chosen at sign-in or in the switcher (`src/lib/session.ts`, `roleFor`). The server asks the role at the property in the address (`roleGate.ts`), so it rang the order as a waiter - nothing wrong was written; the website showed another property's role.

**What was done** — 26 September, by the master with the owner's yes (D26-13): `useRole` in
`src/lib/session.ts` reads the role at the property in the address (`useUi.hotelId`, the code),
falling back to the one chosen at sign-in. `src/lib/session.test.ts`: with the old line back it
fails "expected 'front_desk' to be 'pos'".

---

---

## Fixed

### POS-34 · One fewer of a sent dish with several variation types failed: "Something went wrong" - FIXED 9 October (the owner's "check it and fix it")

**Found** — suspected on 9 October while mapping the add-ons (the struck copy named its columns and
left out `extra_choice_ids`), confirmed by reading 164's trigger, then proved: a Pizza (Large,
Cheese burst) ×3 sent, a manager lowering it to 2 with a reason got `500 {"error":"Something went
wrong. Nothing was changed."}`. 164's `app.pos_line_names_its_variation` fires on every INSERT
(its column list limits only UPDATE) and requires one choice of each further type; the struck copy
carried `'{}'`. Striking the whole line still worked (`voided` is not in the trigger's list), so a
manager could only take all three off and ring two again - a new docket for food already cooking.
Reachable since 30 September (164).

**What was done** — the struck copy carries `extra_choice_ids` (and `numbered_addons`, D27-289), so
it is what the dish was. And 209: a line STRUCK AS IT IS WRITTEN is not checked against today's
menu - a dish that gained a Crust after it was rung would otherwise still refuse its own struck copy
- while every line that sells is checked as before. Guarded: `variationTypes.test.ts` "one fewer of
a sent dish with several types (POS-34)" (failed with the 500 first); the database's "pos audit
guards" (a struck copy with no crust goes in; a sold one is still refused).

---

### POS-32 · The KOT station's print test lost a race on a busy machine - FIXED 9 October (the owner's yes, D27-289)

**Found** — the first full gates on the new PC (`cp6-9oct`, 13460f7e): web 1 failed of 1,122,
`KotStation.test.tsx` › "prints a new KOT once, with the slip in the page while it prints",
`expected <div class="kot-print">… to be null`. Alone the file passed 5 runs of 5. `KotStation.tsx`
draws the slip with `flushSync(() => setSlip(d))`, calls `window.print()`, then `setSlip(null)`
WITHOUT `flushSync`, so the slip leaves the page on React's next render. The test waited for
`print` and then asserted at once that the slip was gone, outside any wait: under the full suite's
load the render had not happened yet. On the desk nothing was wrong (`print()` blocks the page; the
slip goes as soon as it returns).

**What was done** — the test waits for the slip to leave (`vi.waitFor`) instead of asserting at
once; the component is unchanged. It passes 6 of 6, and with the slip never removed (`finally {}` in
`KotStation.tsx`) it still fails "expected <div class="kot-print">… to be null": it guards what it
guarded, minus the race. (The full gates on 876bc94b, race and all, happened to pass it - a race
shows when it likes, which is why it is gone rather than waited out.)

---

### POS-33 · "Close unpaid" never freed the table: it stayed blue (or orange, or green) with its amount, and nothing on Tables cleared it - FIXED 9 October (82a173b3, the owner's answer: a Clear button)

**Found** — the owner, 9 October: "when we are closing without payment, it still remains in the blue
screen, I'm not able to get rid of the table, and the amount still stays". Reproduced on the local
demo the same night: AC3, Veg Biryani sent (₹326), Till → Close unpaid with a reason. The order became
`abandoned` with its reason and `cleared_at` NULL, and `GET /till/floor` still returned AC3 with that
order, `state: "kot"`, `payable: 325.5`. Not sent, the same order shows `running` - blue. Seen again by
the owner: N2, DH-005 (₹1,061, 5 covers) closed unpaid, the Till showing it "Closed unpaid", while
Tables showed N2 green - its bill had been printed - with no way to clear it "for the next guests to
come".

**Why** — `app.pos_floor` (047) took each table's newest order with `cleared_at is null`, whatever its
status, and its CASE had no branch for `abandoned`: it fell through to `running`, `kot` or `printed`,
and `payable` was the bill's total. The abandon route sets only the status; the Clear route would have
accepted it (it refuses only an `open` order), but `Floor.tsx` offered Clear only on a `paid` tile. So
tapping the tile opened a pad whose Send was refused, Restaurant setup refused to switch the table off
(`TABLE_BUSY`), and with no date filter it outlived the day. And the trap in the way round it: a new
order typed for the same table, once cleared, brought the abandoned one back as the newest uncleared
order, amount and all. Untested until now: `till.test.ts`'s floor test covered the paid path only.
Reachable since 28 September (before that Close unpaid did nothing, QA POS-2).

**What was done** — 82a173b3, the owner's choice of 9 October (a Clear button, as a paid table has,
rather than freeing the table at once):
- 207 replaces `app.pos_floor` with a sixth state, `closed`, ahead of every other but blank, and no
  amount for it. Printing a closed bill no longer turns it green, so the print route needed no change.
- `Floor.tsx`: a `closed` tile reads "Closed unpaid" on grey, takes no round, has no arrow and has
  Clear; the legend has "Closed unpaid - clear it".
- The Clear route frees the table of EVERY finished bill on it, so one closed unpaid under a later
  one cannot come back.
- Tables stuck today show Clear the moment 207 runs (on the local demo: AC3 and N2 did at once).

Guarded, each seen failing first: `db/tests/modules/pos.sql` "pos floor" (6; on 047, 3 fail -
`running`, `0.00`, `printed`), `api/test/modules/pos/till.test.ts` "a bill closed unpaid, on the floor"
(2; on 047 "expected 'kot' to be 'closed'", with the one-order Clear "expected 'closed' to be
'blank'"), `src/modules/pos/closedUnpaid.test.tsx` (1; on the old tile "expected '38 minN2-' to contain
'Closed unpaid'"). Opened on the demo: AC3 cleared to free from its tile.

---

### POS-27 · "It just keeps adding new dishes": the same dish tapped again made a new line - FIXED 30 September (D27-189)

**Found** - the owner's report of 30 September, reproduced that morning on `fidato_s46` as the GM:
- **Tables:** three taps on Butter Roti gave three pad lines of "1 Butter Roti". `flows/OrderPad.tsx` `put()` appended every tap and never looked for the dish already on the pad. The server joined them at Send, so the kitchen got 3, but the waiter's pad did not show it.
- **The Till:** Bhaaji Pau (Butter) + Onions, chosen the same way twice, gave two lines. `addOneLine` in `till.ts` is the one place every line is written, and it merged a plain dish but started a new line for any dish with sides. The Till also had no −, only the strike.
- **The Terminal:** two presses of + on a sent Butter Roti gave two new lines of 1. The quantity route's "more of a sent dish" branch made its own insert on every press, outside `addOneLine`.

**What was done** - `addOneLine` treats a dish as the same when its variation, its note and exactly its sides are the same, and only while it is unsent (D27-148). The dish and its sides go up together. More of a sent dish on the quantity route now goes through `addOneLine`, so it joins that dish's unsent line and copies its sides (D27-192, Q7). The pad's `put()` joins the same way. The Till has a − beside each dish; for a sent dish it asks for a manager's reason (D27-119). Guarded by `api/test/modules/pos/sameDish.test.ts` (4) and `src/modules/pos/sameDish.test.tsx` (4); all 8 fail on cp6's code.

**The rule** - The screen a person reads must say what the kitchen will get. A pad that shows three ones while the server makes one three is right on paper and wrong at the table.

### POS-28 · A dish's quantity changed without its sides - FIXED 30 September (D27-192, Q8)

**Found** - 30 September, reading the quantity route for POS-27. Setting an unsent dish's quantity (the Terminal's −/+) updated the dish's line only. So "Bhaaji Pau (Butter)" raised to 2 billed two plates with one lot of Onions. Lowering a sent dish (D27-119) did the same. The Terminal also showed each side as a line with its own −/+.

**What was done** - The route sets the dish and its sides together. On the Terminal the sides sit under their dish, as on the Till, with no −/+ of their own. Guarded by `sameDish.test.ts` ("the quantity of an unsent dish takes its sides with it") and `sameDish.test.tsx` ("a side follows its dish").

**The rule** - A child line priced per plate must move with its plate.

### POS-31 · MINE: the "7 ready" badge wrapped to two lines on a desktop Tables tile - caught before commit

**Found** - 1 October, opening Tables at 1280 wide for D27-221. The badge sat in the tile's action row beside its two round buttons: the row is 126px wide and the three need about 167px, so it read "7 / ready" on two lines. The web test passed, because jsdom has no layout.

**What was done** - The badge has its own full-width row under the amount, above the actions (`Floor.tsx`), `whitespace-nowrap`. Measured again: 126 x 44 at 1280 wide, 136 x 44 on a 375 phone, one line, and no sideways scroll.

**The rule** - A button added to a row of fixed-size buttons is measured at the narrowest tile before it is called done.

### POS-30 · MINE: a commit hash sent to the master before git printed it - corrected at once

**Found** - 30 September, the POS lane's report after renumbering its migration. The message named the commit "10d9d4e"; git had printed 76174e7. Caught on reading git's output a moment later, and corrected to the master in a second message.

**The rule** - root MEMORY 349: quote a hash only from git's own output, copied after the commit prints it.

### POS-29 · The till's float was typed at night and read as ₹0 when left blank; the night count on a closed day answered 500 — FIXED 30 September (cash lane, D27-190; numbered for now)

**Found** — the cash lane, reading Close restaurant day for D27-190: the day's row was made by the night count, whose `opening` fell back to 0 (`input.opening === undefined ? 0`) and whose screen sent `Number(opening) || 0`. Cash was taken all day before any float was counted (D27-139, which D27-190 replaces). A count sent after the day closed tried to update the closed row and the final trigger raised: a 500.

**Fixed** — "Open the day" (`POST /till/day-end/open`) counts the float once, on the note grid; Settle refuses cash (only) until the outlet's day is open; the night count needs the opened day, no longer types or defaults the float, and refuses a closed day in words. The close asks the float kept for the next day (D27-191).

**Proved** — `api/test/modules/finance/cashCounts.test.ts` (cash and a split with cash refused before Open the day, a card goes on, the count refused, a blank float refused, opened once, then cash taken; each failed with its guard taken out) and `till.test.ts`'s close without a float kept.

**The rule** — A drawer's first figure is counted before its first rupee, never typed after its last.

### POS-24 · The Till never sent anything to the kitchen - FIXED 29 September (D27-166)

**Found** - 29 September, by the speed and workflow check (`docs/qa/speed-2026-09-29.md` on `qa/speed-29sep`, finding 5, W-1): two Till orders charged to rooms 301 and 202 stayed `kot_status = pending`, had no KOT number and never reached the Kitchen screen. `pages/Till.tsx` opened an order, added dishes, struck and settled, and never called `sendToKitchen` or the batch route with `send: true`. Tables' order pad always sends its round; the Terminal has "Send to the kitchen". So with the KOT station (D27-159) a Till order would never have printed either.

**What was done** - The owner's D27-166 (option a of three; no automatic send at charge or settle, which would send food already eaten; no refusal to settle): the Terminal's own button on the Till's order - orange, "Send to the kitchen", "Kitchen has it all" and switched off when nothing is unsent, first above the bill's other actions - through the same `sendToKitchen`. Guarded by `ownerDecisions.test.tsx` ("the Till's Send to the kitchen (D27-166)"): on the old Till there is no such button and the test cannot find it.

**The rule** - Three screens that take the same order must all reach the kitchen. A way in that only writes to the bill is a way round the kitchen.

### POS-25 · MINE: the KOT station asked again at once after a claim another tab had won - caught before commit

**Found** - 29 September, building the station (`components/KotStation.tsx`). After each docket the printer asked the server again straight away, whatever had happened. Its own test ("prints nothing when another tab claimed it first") answered every ask with the same docket and every claim with "no", and the loop asked, claimed and asked again until the test's worker ran out of memory and died ("Worker exited unexpectedly"). Against the real server the second ask would no longer list a docket another tab had claimed, but a docket the server kept listing for any other reason would have spun the same way on the kitchen PC.

**What was done** - It asks again at once only after it has printed; a lost claim or a failure waits for the next ask (the live channel or the 30-second floor). The test now passes, and with the claim check taken out (printing whatever the claim says) it fails.

**The rule** - A loop that re-asks on its own result needs a reason to stop that does not depend on the other side changing its answer.

### Retired by D27-161 (29 September): POS-5's slip on every send, POS-10's notice, POS-11's order

The KOT station prints every KOT; no other device opens or offers one. Tables and the Terminal no longer open `/h/:code/till/orders/:id/kot/:no` on a send (D17-18, POS-5), so a browser refusing the tab (POS-10, `components/SlipNotice.tsx`) and the draft cleared before the tab (POS-11) no longer arise. `SlipNotice.tsx` and `pages/Docket.tsx` are gone; the docket's layout is `components/DocketSlip.tsx`, printed by the station. The entries below stay as the record.

### POS-19 · the waiters list (till.ts) showed nobody but the caller - FIXED 28 September (D27-97)

Read from `staff` joined to `staff_hotels`, whose row security shows each person only their own line unless they run the hotel (housekeeping HK-14). Now reads `app.hotel_people` (149), names only. `api/test/modules/pos/waitersList.test.ts` - failed on the old code, passes now.

### POS-17 · MINE: Restaurant setup's ready-to-open list said "None yet" for a dish on the menu — caught before commit

**Found** — 25 September, on the saved screenshot of the finished setup: "Dishes on the menu - None yet" at a property whose menu held Dal Tadka (the API answered it). The app keeps a read until told otherwise (`staleTime: Infinity`, `src/App.tsx`) and keeps `till-menu` on the device (`PERSISTED`), and the capture's browser had read the menu empty on the "before" screenshot. Any dish added on another device, or by the kitchen manager, would have left the list stale the same way.

**What was done** — Both of the page's reads (`till-setup`, `till-menu`) carry `staleTime: 0`, so they are asked again every time the page opens; the recapture ticked all six (`.local/screenshots/2026-09-25-till-setup/03-setup-DONE-*.png`).

**The rule** — A list that says what is done reads fresh. A cached read is fine for a screen people work in; a checklist people trust must not be older than the page.

### POS-15 · A dish imported with its GST column blank reads "0%" on the Menu screen and the Terminal — FIXED 22 September

**Found** — 21 September, on screen, importing a menu file with variations: "Mutton Rogan Josh | 0% | -". The import stores `tax_rate` NULL when the GST % column is blank — meaning "follow the section's heading" — and `addOneLine` resolves it when the dish is rung. But `GET /till/menu` sends `taxRate: Number(r.tax_rate)`, and `Number(null)` is 0, so the Menu row and the Terminal tile print **0%**. Measured in `fidato_pos_menu`: that dish's section (Main course) has no tax heading, so `app.gst_rate_or_null` answers NULL and ringing it would be refused with the "has no GST rate" sentence — the screen shows 0% for a dish that has no rate at all. A missing figure shown as a zero (HANDOVER § 5). Older than this job: every dish imported with the column blank.

**What was done** — On the owner's D21-94 ("Show the rate its section actually charges, or a dash where none is set"): the rate a dish is rung at is written once, `DISH_TAX_RATE` in `api/src/modules/pos/till.ts` (its own rate, else `app.gst_rate_or_null` for its section's heading and price). `addOneLine` copies it onto the line and the menu read now sends it, null when nothing is set, so the screen cannot show a rate the bill does not charge. The Menu row, the Terminal tile and the Till tile print "-" for a null and keep a real 0% as "0%". Guarded by `api/test/modules/pos/menuTaxRate.test.ts` (the menu's rate equals the rung line's; null for a section with no rule; a dish's own 0 stays 0) — before the server change it failed `expected +0 to be 5` and `expected +0 to be null`; and by `ownerDecisions.test.tsx` ("a dish's GST reads its section's rate, or a dash") — with the three screens' dash taken out, all three failed on `Unset Dish%₹200.00` (a bare "%").

**The rule** — A figure a screen shows beside a thing is the figure the server will act on, read from the same expression, not a column that feeds it. And `Number(null)` is 0 - a nullable number crosses the wire as null.

### POS-16 · A single tap refused over a side put the dish on the bill without it — FIXED 21 September

**Found** — 21 September, adding "how many a guest may choose" to `addOneLine` (`api/src/modules/pos/till.ts`). The dish's line was written first and its sides checked after; a side not offered with the dish, or off today, returned a refusal — and inside `withSession` a returned refusal is a COMMIT (root MEMORY 243). The pad's batch route throws and rolls back, so Tables was safe; the Till and the Terminal (one dish per request) left the dish on the bill with no sides and told the waiter it was refused.

**What was done** — Every check on the sides — offered with this dish, off today, and the group's choose-at-least / choose-at-most (D21-41) — now runs before anything is written. Guarded by `api/test/modules/pos/menuOptions.test.ts` ("is rung on the pad as the rule says…"), which asserts that a refused dish left no line: with the rule check moved back after the insert it failed with `a refused dish left a line on the bill: expected 2 to be +0`.

**The rule** — In a function that writes, every refusal comes before the first write, or it throws. Read the whole function for it, not the line you are adding.

### POS-14 · A dish added with an empty price box landed at ₹0.00 — FIXED 21 September

**Found** — 21 September, reading the Menu screen before adding variations. `CategoryCard.add` did `Number(price)` and the route did `Number(input.price)`: `Number("")` and `Number(null)` are both 0, so an empty box added the dish at ₹0.00 — a default price, which HANDOVER § 5 forbids and D21-42 had just ruled out for add-ons.

**What was done** — On the owner's yes (21 September, "Refuse a blank"): the screen refuses an empty box ("Type a price. A blank is not zero - type 0 for something that is free."), and the server's `typedPrice` returns null for a blank, a null or a word, used by the dish route and every new variation and add-on route. A typed 0 is kept. Guarded by `menuOptions.test.ts` ("refuses a DISH added with an empty price box"); with `typedPrice` reading a blank as 0, five tests failed. **Opened**: Main course, "Chicken Biryani", empty price, Add → "Not added", no request sent; 250 typed → added.

**The rule** — `Number()` of a blank is 0. A price read from a person goes through one function that knows the difference.

### POS-13 · MINE: a database check that crashed the suite instead of failing — caught before commit

**Found** — 17 September, building D17-21. `db/tests/modules/pos.sql` checks that a bill settled "to a function" with no function is refused. With the constraint taken out of the migration, the suite exited 1 — but not on that check: the wrong settle went through, and the file's own clean-up then could not remove a settled order's payment ("tenders on a settled order cannot be removed"), so the whole suite stopped with "the suite did not finish". A red run for the wrong reason, and every assertion after it silently unrun.

**What was done** — The attempt runs inside its own block that raises to undo itself when the settle is allowed, and records "it was allowed"; the check fails by name. Re-run with the constraint out: `pos function 7 passed, 1 failed — a bill settled to a function with no function is refused | it was allowed`, the suite finished. Restored: 744 of 744.

**The rule** — A guard's failure proves something only when it is the guard's own message (root MEMORY 259). A check whose failure case leaves rows its clean-up cannot remove turns one failure into a stopped suite — undo the attempt inside the check.

### POS-12 · An order taken on Tables printed no table — on its kitchen slip, its bill and the Terminal's list — FIXED 17 September

**Found** — 17 September, on screen, checking the slip Tables now opens (D17-18): "KOT - 1 · Dine In" and no table, while the Terminal listed orders 1 to 4 — taken on AC1 to AC4 — as "no table". In the database each had `table_id` set and `table_ref` empty. The slip, the bill and the list all print `table_ref`. Opening one order by itself (`POST /till/orders`) copies the table's name into `table_ref`, and its comment says why; the order pad's route (`POST /till/orders/batch`) kept only the id. So since the order pad was built (8 September) the paper a kitchen works from has not said which table.

**What was done** — On the owner's yes ("Fix it", 17 September; not back-filled): the batch route's insert takes the table's name when a table is given, the floor's name winning over typed text, as the other route does (`api/src/modules/pos/till.ts`). Guarded by `api/test/modules/pos/tillBatch.test.ts` ("copies the table's name…"), which failed on the old insert with `expected null to be 'AC1'`. **Opened**: AC5, Jeera Rice, Send → the slip "KOT - 6 · Dine In · Table No: AC5". Orders taken before the fix keep no name.

**The rule** — Two routes that make the same row must write the same columns. A column one of them fills "for the paper" is the first one the other forgets, because nothing on the screen that made the order shows it.

### POS-11 · MINE: a sent round could stay saved on the device as unsent — caught before merge

**Found** — 17 September, on screen, after `50080a0`. D17-18 opened the slip before the pad cleared its saved draft. In the preview pane the new tab REPLACED the page, so the clearing never ran: table AC1 read "not sent", with Bhaaji Pau still in "This round" after it had gone to the kitchen as slip 1 — one Send from being cooked and billed twice. A desktop browser keeps the page, but a browser set to open new windows in the same tab, or a kiosk's web view, does not.

**What was done** — `flows/OrderPad.tsx` clears the draft first, then opens the slip (milliseconds of the browser's few seconds). Guarded by `ownerDecisions.test.tsx` ("takes the sent round off the device BEFORE it opens the slip"). **Its first version passed with the fault put back**: the pad also clears an empty draft by itself as it opens, and the test counted that one. It now records only from the moment Send is pressed, and fails on the fault (`expected 'slip opened' to be 'draft cleared'`). Re-checked on screen: two sends that replaced the page left no draft and no "not sent".

**The rule** — Anything after `window.open` may never run: do what must happen before opening. And when a deliberate break leaves a test green, find out whether the test counts something else that looks the same (root MEMORY 270).

### POS-10 · A slow send opened no kitchen slip, silently — Tables and the Terminal alike — FIXED 17 September

**Found** — 17 September, building D17-18. A browser lets a tap open a new tab only for a few seconds after the tap (Chrome and Firefox: about five). Both screens open the slip AFTER the send answers, so on a line slow enough that the answer takes longer, the browser blocks the tab and says nothing to the waiter. `window.open` returns `null` when that happens, and neither screen read it. The Terminal had had the gap since 2 September.

**What was done** — The owner's answers (17 September): say so, with a button, **on the screen** rather than in a pop-up (the shared pop-up has no button and is gone in 4.5 seconds). `components/SlipNotice.tsx`: `openSlip` reads the refusal; the notice reads "Order 4 for AC4 is with the kitchen, but its slip did not open — the browser blocked the new tab." with **Open the kitchen slip** (a new tap, which the browser allows) and a close button; one line per slip, until opened or closed; refused on the new tap too, it adds "allow pop-ups for this site in the browser". On Tables (under Start here) and the Terminal (under its header). Guarded by five tests in `ownerDecisions.test.tsx`; with the hand-off, the Terminal's notice and the "blocked again" line each taken out, three failed. **Opened**, with the browser made to refuse: Tables AC3 and AC4 (the notice, the second refusal's sentence, then the button opened slip 4), the Terminal order 5 (the notice under the header, 61px, no page scroll, no console error).

**The rule** — A tab opened after a network call is a tab the browser may refuse; read the return value.

### POS-9 · On a phone, every dish row on the Menu screen showed no dish name — FIXED 17 September

**Found** — 17 September, measuring the add-on switches (D17-19) at 375px. Each dish row put the name, the tax rate, the price, the course, the preparation time, "Out of stock" and "Take off" on one line that could not wrap. At 375px the row needed 465px and had 302: **the dish name was squeezed to 0px** and the last buttons sat outside the card. It had been so before 17 September.

**What was done** — On the owner's yes: the controls are one group that goes under the name when the row is too narrow; the name keeps at least 8rem (`pages/Menu.tsx`). Measured: at 375px four dishes' names 171–178px wide, nothing past the row, no sideways scroll; at a desk every control still on the one 44px line. No test — jsdom has no layout; the measurement is the proof.

**The rule** — A row of controls is measured at phone width before it is called done; a name squeezed to nothing looks like a missing name, not like a layout.

### POS-5 · The kitchen docket is built, and nothing ever opens it — FIXED 17 September (Tables)

**Found** — 16 September, checking whether this system can route and print a KOT. `DocketPage` is real, thermal-roll width, prices deliberately absent, with a Print button at `pages/Docket.tsx:64`. Its address is `/h/:code/till/orders/:id/kot/:no` (`routes.tsx:53`). **No file in `src/` navigates to it.** Grepped for `till/docket`, `/docket/` and the built path: nothing. Compare the bill, which is opened with `window.open` from three places — `Floor.tsx:138`, `Terminal.tsx:657`, `Till.tsx:985`.

So when a waiter presses Send, the toast says "Kitchen docket 5" (`flows/OrderPad.tsx:230`) and no paper appears. The chef's slip exists as a screen nobody is taken to.

This is the website twin of POS-2, and the 16 September route audit did not catch it: that audit matched **API** routes against their callers, and this is a **website** route.

**The fix, when it is done** — Ask the owner first: is the pass screen the intended path at 5 Elements today, with the docket kept for a reprint? If dockets are meant to print, the fire path opens the docket for each new KOT number, the way the bill is already opened. Both halves of a KOT — routing it and printing it — are planned in `docs/APPS-PLAN.md`; this is the smaller half and does not wait on it.

**Corrected 16 September (POS lane, round 1) — half of this entry is wrong.** The **Terminal does open the docket**, on every send, and has since 2 September (`76c400f`, "P6: the kitchen docket"): `pages/Terminal.tsx`, `kot()`, `window.open(\`/h/${hotelId}/till/orders/${orderId}/kot/${res.kotNo}\`)`. The grep missed it because the path is assembled from pieces. What is true: **sending from Tables** — the order pad, `flows/OrderPad.tsx` — opens nothing, and says "Kitchen docket 5". So the owner's question is narrower than it reads above: should Tables do what the Terminal already does. Not started — the owner decides (round 1, `HANDOVER.md` § 3.0g).

**What was done** — The owner's D17-18 (17 September): *"Tables opens the kitchen slip on every send, like the Terminal."* `flows/OrderPad.tsx` opens `/h/:code/till/orders/:id/kot/:no` when the send comes back with a docket number, before anything else is awaited (a browser allows the tab only for a few seconds after the tap — POS-10). Nothing opens for a round that went on the bill alone, or for a round held on the device: the kitchen has neither. The toast's words did not change. Guarded by `ownerDecisions.test.tsx` ("Tables sending a round"), the first test seen to fail on the old code. **Opened on screen** (17 September, `fidato_pos`, as the owner): table AC1, Bhaaji Pau (Oil) with Curd, Send → the slip "KOT - 1 · Dine In · Bhaaji Pau (Oil) 1 · Sides: Curd - 1", no price on it, for order `20260825-1`.

**The rule** — A screen with no caller is the same defect as a route with no caller, and the audit that only checks the server finds half of them. **And a grep for a built path proves nothing about a path built from template pieces** — search for the route's distinctive fragment (`/kot/`) before writing "nothing opens it".

### POS-2 · Two restaurant add-on routes are unreachable — FIXED 17 September

**Found** — 16 September, the route audit — every route matched against every path the website builds, then checked by hand.

`POST /:code/till/addons/:id/on` and `/off` (`till.ts:2011, 2035`) have no caller anywhere. Menu items can be switched from the Menu screen; the add-ons on a dish cannot be switched from any screen.

**What was done** — The owner's D17-19 (17 September): *"On/off switches for add-ons on the Menu screen, like dishes have."* The Menu screen had never shown add-ons at all. Each dish now lists its add-on groups under it, and each add-on has the dish's own control — "Out of stock" → 2, 4, 8, 24 hours or Tomorrow → "Off till 04:46 pm — put back" (`pages/Menu.tsx`, one `OffControl` for both; `data/till.ts` `takeAddonOff`, `putAddonBack`). Two differences, both the database's: **no "Why"** (`pos_addons` keeps no reason and the route takes none), and **a group can be on several dishes**, so the dialog names every dish it goes off on. No permanent "take off the card" for an add-on: nothing on the server does that (`is_active` has no route, and the menu read hides inactive add-ons). On a phone the add-on row wraps rather than squeezing the name (measured, 375px). Guarded by `ownerDecisions.test.tsx` ("the Menu screen's add-ons"). **Opened on screen**: Onions off for 2 hours → 200, the dialog closed, "Onions is off · Back in 2 hours", the row "Off till 04:46 pm — put back", `off_until` 16:46 in the database; the waiter's dish dialog on Tables showed Onions struck, "off today"; put back → 200, "Onions is back on".

**The rule** — A route with no caller is either a missing screen or dead weight; it is never 'done'.

### POS-7 · Three more raw business dates on Close restaurant day — FIXED 17 September

**Found** — 16 September (POS lane, round 1), fixing the one named in the brief. `pages/DayEnd.tsx` prints `day.businessDate` raw in three more places: the "… is closed" line on the Finalize step, the toast "… is finalised.", and the button itself — **"Close 2026-08-25"**. The heading above them now reads "Tuesday, 25 August 2026", so the same screen shows the date two ways.

**What was done** — The owner's D17-20 (17 September): *"Tuesday, 25 August 2026" — and the hotel's name with it, the button too.* All three, and the line under the heading: "5 Elements Akkalkot · Fidato Restaurant · Tuesday, 25 August 2026"; "Tuesday, 25 August 2026 · 5 Elements Akkalkot is closed"; the toast "… is finalised."; the button **"Close Tuesday, 25 August 2026" over "5 Elements Akkalkot"**. The name is the session's name for the page's OWN code, not the property "in view" (the store follows the address a moment late), and the code itself when no name is known — never another hotel's. Guarded by `ownerDecisions.test.tsx` ("Close restaurant day"). **Found on screen before commit:** on one line the button's label was 355px in a 317px button and ran out over both edges; it is two lines now, the full sentence kept as the button's spoken name. Re-measured: 317 = 317 at a desk, 294px with nothing over at 375px, no sideways scroll.

**The rule** — A format fixed in one place on a screen is not fixed on the screen: read every place the same field is printed. **And a longer label is measured in the button that holds it.**

### POS-8 · MINE: the add-on dialog's duration buttons bypassed their own handler — caught before commit

**Found** — 17 September, by `npx tsc -b --force`, after the tests had passed. Making the dish's off control serve add-ons too, I renamed its handler `choose` and left the dialog's buttons calling `takeOff(o.key)` — which was now the prop that posts to the server. The request went out; the dialog never closed, no toast, the menu was not read again. **The tests passed** because they asserted only that the request was sent.

**What was done** — The buttons call `choose`. The test now also waits for the dialog to close and the menu to be read again; with the fault put back it fails ("expected dialog to be null").

**The rule** — A test that checks the request a screen sent passes while the screen never finishes the act. Assert what the person sees afterwards too. And run the type check before trusting a green test run — here it was the only gate that saw it.

### POS-3 · The Kitchen screen had no heading — FIXED 16 September

**Found** — 16 September, opening all 89 screens: it is the only one without an `h1`.

The kitchen wallboard opened straight into its columns under a title drawn as a paragraph ("The pass"), and its browser tab read "Fidato PMS".

**What was done** — The wall screen keeps its own slim header (a `PageHeader` would add chrome to a screen read from across a kitchen), but the title in it is now the page's `h1`, and it says **Kitchen** — the menu's word, as `HANDOVER.md` § 6 requires of a heading and a tab. `useDocumentTitle("Kitchen")` sets the tab. Guarded by `readStates.test.tsx` ("has a heading and a tab title"), seen to fail on the old code.

**The rule** — The only screen unlike every other screen is either special on purpose or an oversight; say which. This one is special on purpose in its chrome and was an oversight in its heading.

### POS-4 · A server fault on the till's reads showed as an empty list — FIXED 16 September

**Found** — 8 September (root MEMORY 251 fixed the refusal half); the rest was recorded in PENDING § 6.

Nine reads in `data/till.ts` ended in `catch { return [] }` (or `null`): the menu, today's orders, one order, the chargeable rooms, the kitchen board, the tables, the waiters, a docket and the day end. So Close restaurant day told a cashier "This property has no restaurant configured" when the line dropped; the kitchen board said "Nothing ordered yet." while nothing had loaded; the Terminal said "No outlet is configured" while its outlets were still loading, and for good when they failed; a bill that failed to load printed "No such order."

**What was done**
- The nine reads **throw**. A missing hotel or order id still answers empty without a request.
- `components/ReadProblem.tsx` names the failure: **refused** (a 4xx — the server's own sentence, as it wrote it), **unreachable** (nothing arrived), **failed** (a fault, with its status). `ReadFailed` stands in for a list that has nothing to show; `ReadStale` is one line above a list that IS shown when its last refresh failed, with the time it was loaded.
- Every screen reading them draws the right one: Kitchen, Tables, Till, Terminal, Menu (and its promotions, whose read already threw and whose error nothing drew), Close restaurant day, Docket, Bill, the order pad, and the header panel's waiter list. **Empty keeps each screen's own words**, now shown only for a read that succeeded.
- Kitchen and Menu also drew their empty words **while loading**; they show a loading state now.
- Guarded by `src/modules/pos/readStates.test.tsx` — 12 tests, 11 of them seen to fail against the old code.

**The rule** — An error that renders as emptiness is the most expensive kind: nobody reports it. **And catching an error in a data function is not handling it — it takes the decision away from the only place that knows what to say.**

### POS-6 · The rooms list kept on the device for an offline room charge was wiped by the first offline refresh — FIXED 16 September

**Found** — 16 September, fixing POS-4. `till-rooms` is in `PERSISTED` (`src/App.tsx`) by the owner's decision of 8 September, so a waiter can charge a dinner to a room with the line down. Both settle panels ask for it again every time they open (the Terminal with `staleTime: 0`), and `listChargeableRooms` answered a failed request with `[]` — a **successful** empty answer, which React Query stored over the kept list and persisted. So the first time the panel opened with no connection, the room list the owner chose to keep was replaced by an empty one.

**How it was proved** — `readStates.test.tsx`, "keep the rooms list kept on the device…": a query cache holding a room, then a refresh that cannot reach the server. Against the old code: `expected [] to deeply equal [ { room: '203', … } ]`. Against the fix it keeps the room.

**What was done** — `listChargeableRooms` throws (POS-4), and React Query keeps the last good list when a refresh fails. **Nothing that posts a charge changed**: the room box has always accepted a typed room number, the list is only its suggestions, and `settleOrder` and the server's settle route are untouched.

**The rule** — A value kept for offline use must never be overwritten by a read that failed. A `catch` that returns a default turns a failure into a fact, and a cache believes facts.

### POS-26 · "Charge to room" on a room with two open bills charged nobody, and looked done — FIXED 29 September (folio lane)

**Found** — the owner, on the local demo, 28 September 22:27: a ₹3,875 dinner charged to a room never reached the guest's bill. Read-only on the master's `fidato`: the order (20260825-1) was still open, no order had ever been settled, `pos_tickets` was empty, and the telemetry (150) held one `POST /till/orders/:id/settle` at 22:29 answering 409. Room 201 held two checked-in stays (the demo's changeover). Reproduced on `fidato_s31` in the app's pane: the D27-117 confirm said "Charge ₹3,875 to room 201? Tanvi Bhide or Rekha Gaikwad will see it on their room bill.", closed on its "Charge to room", and the server's "which of the two?" came back as two small lines under the total, with no toast. The order stayed open. Nothing in the posting code was wrong: it was never reached.

**Fixed** — the owner's D27-162: one box asks. `roomAsk` (`components/AskDialog.tsx`), used by the Till and the Terminal, puts one button per open bill in the confirm itself ("Room 201 has 2 open bills. Whose is it?"), a company bill named "guest - bill to company" (`/till/rooms` and the settle's choices now carry the company); the server's own "which?" or its refusal is read in the same box (`Reply`: `{ refused }` or `{ next }`). The two side panels are gone.

**Proved** — `restaurantFixes.test.tsx`: "a room with two open bills asks whose in the same box, one button each" and "a room charge the server refuses says why in the box that asked"; both seen to fail on the old screens. On screen (`fidato_s31`): the box offered Tanvi Bhide and Rekha Gaikwad, the press settled 20260825-1 to Tanvi Bhide, and her Bill tab showed "Fidato Restaurant - 20260825-1 · ₹3,875".

**The rule** — A question the server asks after "yes" must be asked in the box that got the yes. An answer drawn anywhere else is an answer nobody reads.

### POS-23 · An order settled to a banquet function reached no bill and no tax invoice — FIXED 28 September (round E)

**Found** — round E, planning the function's bill (QA BQ-1): since 099 an order settled "to the function" touched no folio; the function's quotation counted it, but its bill, its payments and its tax invoice could not.

**Fixed** — the owner's D27-133: the till posts it onto the function's open bill exactly as the room branch posts a room charge (one line per tax rate from `app.pos_order_by_tax`, a `pos_tickets` row each, `source_type 'pos'`), with `payment_method` still 'function'. The day book's till side (`reports/figures.ts` posSales) leaves 'function' out as it leaves 'room', so it is counted once, from the folio.

**Proved** — `api/test/modules/pos/functionOrders.test.ts` "onto the function's bill as a room is charged", which also checks the day book's till side does not move; seen to fail on the old till.

### POS-20 · Two Settle presses on one bill both took the money — FIXED 28 September (release fixes)

**Found** — 28 September, the release review before 40c9510 went live.

`POST /till/orders/:id/settle` read the order with no lock, checked `status = 'open'`, then wrote. Two presses at once both read "open", both set it settled and both wrote tenders: one bill, two payments in the drawer. A room press beside a cash press charged the folio AND the drawer (two room presses were stopped by `pos_tickets`' unique ticket_ref, as a 500).

**Fixed** — the order read is `for update of o` (`api/src/modules/pos/till.ts`), above both branches. The second press waits, reads "settled" and is refused with "This order is already settled." before anything is written (MEMORY 243).

**Proved** — `api/test/modules/pos/settleTwice.test.ts`: two presses sent together give 200 and 409 and ONE tender row. On the old code: `[200, 200]`. ⚠ Its first version passed on the old code: the first press took the only idle database connection and settled before the second had opened one, so they never overlapped. The pool is now warmed first.

**The rule** — A race test proves nothing until it has failed on the code it guards; check that the two requests really overlap.

### POS-21 · The first bill settled to a banquet function would have stopped every deploy after it — FIXED 28 September (release fixes)

**Found** — 28 September, the deep audit (D27-89). `038` dropped and re-added `pos_orders_payment_valid` without 'function', unguarded; `099` widens it, guarded. On every replay 038 put the narrow check back, a settled-to-a-function row failed it, and the one migration transaction rolled back: `launch.sh` stops.

**Fixed** — 038 replaces the check only while it does not know 'split' (099's pattern), corrected in place. `db/tests/rerun.sh` seeds a bill settled to its function between the passes, so the replay test sees the row production will have.

**Proved** — `rerun.sh` with the old 038: "1 of 148 abort on a second run" at 038 ("violated by some row"); with the fix all 148 re-runnable.

**The rule** — MEMORY 293 and 299 again: every constraint a later file widens must be guarded where an earlier file re-adds it, and the replay test needs the row.

### POS-22 · Fix round C of the QA of 28 September: the kitchen, the strike, the drawer, the closed day — FIXED 28 September

**Found** — `docs/qa/qa-2026-09-28.md` ("Point of sale and kitchen", "Night audit and closing the restaurant day"), and one more found while fixing them. Branch `fix/restaurant-audit-28sep`; the owner's answers of 28 September, round C 1-6 (the master numbers them D27-…).

- **QA POS-1 · paid food left the pass.** The kitchen feed read `o.status = 'open'` only, so a dish charged to a room or paid before it was cooked vanished. Behind it, a second guard: 028's `pos_order_lines_frozen` refused EVERY change to a settled order's lines, so the chef could not have moved such a dish even once it showed. **Done:** the feed reads open orders and settled orders of today's business date (`till.ts`, the pass); migration 151 lets the kitchen status, and nothing else, change on a settled order.
- **QA POS-2 / NA-4 · `window.prompt()`.** Close unpaid (Till, Terminal) and the dish note (Terminal) asked through the browser, which the app's window refuses: nothing happened and the day could not close. **Done:** `components/AskDialog.tsx`, one dialog for a reason, a note or "are you sure?".
- **QA POS-3 · Tables and the Till disagreed.** A table typed on the Till ("AC2") was kept as text with no `table_id`, so Tables showed it Free and a second bill opened on it; the demo loader did the same. **Done:** `tableNamed` puts a typed name that is a floor table on that table (both routes that open an order) and a running bill refuses a second; `api/scripts/demo-history.ts` sets `table_id` (and reads every table, not the first 12).
- **QA POS-4 · D27-119.** A dish the kitchen had was struck on one tap, by anyone, with no reason. **Done:** `sentStrikeRefusal` in `till.ts` - the owner, an administrator, the GM, the hotel manager or the kitchen manager, with a reason (the owner's answers 1 and 3: also for fewer of a sent dish, and for Close unpaid once any of the bill was sent). The reason is kept (`void_reason`, 151, a check refuses a strike of sent food without one), printed on the docket ("STOP - TAKEN OFF"), shown on the Kitchen screen, and listed on Close restaurant day and in the night audit (`app.pos_struck_after_kitchen`, the answer 4).
- **QA NA-2 · "Over by ₹0.30" on an exact count.** The Till shows whole rupees; the payment was written with paise. **Done:** a bill paid wholly in cash is rounded to the rupee at the settle, on its Round off line (the owner's answer 2); the Part panel shows the whole-rupee bill when every part is cash.
- **QA NA-3 · "Settled ₹0" after six bills.** `day-end` was cached for good, like every non-money screen. **Done:** it is a money key (`src/lib/freshness.ts`, the master's yes).
- **D27-117 · Charge to room asks first** (Till and Terminal), naming the guest (QA POS-8).
- **D27-118 · a closed restaurant day took new bills.** **Done:** `dayClosed` refuses opening a bill and settling once Close restaurant day has counted the drawer, until the night audit moves the date (the owner's answer 5).
- **Found while fixing: a second plate never reached the kitchen.** Tapping a dish again after its docket (or + on it) raised the sent line: the guest paid for two, the kitchen's slip said one, and "Send" found nothing new. **Done** (the owner's answer 6): the bump skips sent lines and + on a sent line adds a new pending one.
- **QA X-2 (the order's phone)** uses `phoneProblem` from `api/src/validate.ts`.

**Proved** — `api/test/modules/pos/restaurantFixes.test.ts` (12; 11 fail against cp6's `till.ts`, the twelfth is the unchanged "a waiter strikes an unsent dish"), `src/modules/pos/restaurantFixes.test.tsx` (4, all fail against cp6's screens), `src/modules/night-audit/nightAudit.test.tsx` (the Run test now confirms first), `src/lib/freshness.test.ts`, `db/tests/modules/pos.sql` ("pos strike", 8). On screen (fidato_s27): a struck Paneer Tikka with its reason on the Kitchen screen and the docket; Close unpaid and Charge to room ("Charge ₹651 to room 202? Sameer Gokhale ...") through the dialog; a room-charged order kept on the pass and moved to preparing; Close restaurant day live after a settle, an exact ₹767 count "The drawer balances", the day closed, a new bill then refused; the night audit's restaurant lines with both strikes.

**Left open** — the Till's own lines do not show a strike's reason (the Kitchen, docket and day's lists do); the pad's quantity stepper on a dish with add-ons leaves the add-ons' quantity (older than this round). Cosmetic QA rows (POS-9, POS-10, POS-11) wait for after the pilot (D27-116); POS-5 (menu ₹0) is round D's.

**The rule** — When a read starts showing what it used to hide, walk every write that screen makes against the new rows: a guard behind the filter (here, the freeze) only shows up then. And a "merge into the line" must stop at the point of no return: once the kitchen has a line, more of it is a new line.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **21** · A grant list that read as a restriction
- **22** · A self-test that could not run, in a file lecturing about self-tests
- **23** · One room, two guests — and code that picked whichever came first
- **24** · A convenience UPDATE against an append-only ledger
- **25** · A cleanup that worked and a measurement that did not
- **54** · Test fixtures with a seat in the application
- **55** · One posting cannot carry two tax rates
- **56** · Fixing the trigger instead of the caller
- **57** · Rupees on a document somebody pays from
- **72** · I contaminated my own reproduction, then reported it as a defect
- **75** · A till that made six taps into six lines
- **76** · A till the kitchen never heard from
- **92** · The dev database was empty and I blamed the code
- **93** · The refusal did not agree with itself
- **112** · A test staff row that had been an employee for months
- **131** · A button is shrink-to-fit, and it took the card with it
- **132** · The window is not the thing the cards live in
- **133** · A screenshot is not a measurement
- **144** · A booking with nowhere to put money
- **154** · The template imported its own instructions
- **171** · A moved guest was charged for the night TWICE
- **172** · The fix broke a departure, and the suite caught it
- **173** · The assertion that reproduced the bug it was checking for
- **181** · The kitchen's live channel — and where it would have gone wrong
- **194** · The till cost three round trips per dish — Rule 2 exists because the CRS replaced its entire backend by rewriting one folder instead of touching 34 screens.
- **195** · A guard that skipped itself, and passed with the bug in
- **199** · The guard the owner asked for was already in the database
- **200** · A settle is four different acts at one address
- **201** · A persisted cache outlived the shape of the thing it cached
- **202** · A function in RETURNING reads the row as it was, not as it is
- **203** · The API typecheck gate was red and I did not notice
- **204** · The assertion that mattered most passed with its own bug in — The rule this earns, on top of 195's:
- **205** · I spelled row-level security by hand and broke nine tests
- **206** · An append-only guard that blocked every teardown in the repo
- **207** · A guard that could not fail, caught before it was trusted
- **208** · `sort_order` and a course are two questions, and the menu proves it
- **209** · A parameter property took the production API down
- **213** · I shipped the audit's own finding, in the audit's own hour — The rule this earns, and it is sharper than "open the screen":
- **223** · Two tests broke on a cap they were never about
- **250** · Any clerk could switch a hotel's modules on or off
- **251** · A refused receptionist was told "There is no menu yet"
- **260** · The restaurant's own roles could not see the restaurant — The rule: a comment that says who a screen is for is a claim — test it against that role's actual menu.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
