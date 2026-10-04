# Manual screenshots - chapters A0 and A1

Every picture `manual.html` waits for, in the order the book uses them. Each one
has a dashed placeholder in the book with the same id; replace the placeholder's
`.shot-plan` box with `<img src="img/<id>.png" alt="...">` and keep the caption
and the numbered list under it.

## How to take them (the master, with the app window in front)

- **Where.** The local demo: web on 5173, api on 8787, the `fidato` database.
  The test hotel only, 5 Elements Akkalkot (`5EL`), made-up guests only (D27-268).
  Never the live system, never a real guest.
- **Who.** "Sign in as" names the test sign-in button on `/signin` (Owner,
  General Manager, Reception, Housekeeping ...), or the account menu's "View as".
- **Window.** Desk shots at **1280 × 800**; phone shots at **375 × 812**
  (the Browser pane's `resize_window`, then reload). Reset to desktop after.
- **Crop.** The local build shows "Development only" test sign-ins on `/signin`
  and a "Development only · view as" part in the account menu. Neither is on the
  live system: crop them out or cover them.
- **Arrows and numbers.** Orange `#FE611F` arrows with numbered circles, placed
  where "Callouts" says. The numbers must match the numbered list under the
  figure in the book.
- **Files.** `docs/manual/img/<id>.png`.
- **Offline shots (A0-13, A0-14).** Stop the "api" preview server, take the
  shot, start it again. Nothing else needs changing.

## Chapter A0 - Getting started

| Id | Address | Sign in as | Size | Callouts (arrow → what) | Before taking it |
|---|---|---|---|---|---|
| A0-1 | `/signin` | nobody (signed out) | 1280 × 800 | 1 Email box · 2 the eye at the right end of Password · 3 orange Sign in · 4 "Trouble signing in?" at the foot of the dark left panel | Crop the "Development only" block |
| A0-2 | `/signin` | nobody | 375 × 812 | 1 the dark "Fidato Hotels" band · 2 Email and Password · 3 Sign in · 4 "Trouble signing in?" under the form | Crop the "Development only" block |
| A0-3 | `/` | Reception | 1280 × 800 | 1 "Start here" heading · 2 the line "Check a guest in" · 3 Got it, top right of the card | If put away: account menu, Show Start here again |
| A0-4 | `/` | General Manager | 1280 × 800 | 1 the dark menu · 2 "Find a screen…" box and Ctrl K · 3 Front office · Restaurant · Settings switcher · 4 bell · 5 name and role · 6 "Business date · …" above the heading · 7 Collapse at the menu's foot · 8 the yellow business-date line (only if it shows) | - |
| A0-5 | `/`, click the name top right | General Manager | 1280 × 800 | 1 name and email · 2 Property · 3 Start on with its tick · 4 Sign out | Crop "Development only · view as" |
| A0-6 | `/settings/property/profile` | Owner | 1280 × 800 | 1 switcher with Settings highlighted · 2 "Back to front office" · 3 the group names (Property, Rooms, Rates and tax …) · 4 an entry with the ↗ mark under Rooms | - |
| A0-7 | `/pos/5EL/tables` | General Manager | 1280 × 800 | 1 switcher with Restaurant highlighted · 2 the Restaurant menu | If Restaurant is missing, the hotel's POS module is off |
| A0-8 | any page; Ctrl K, type `audit` | Reception | 1280 × 800 | 1 the search box · 2 a result marked "Not in your menu" · 3 its section name, right · 4 the Enter mark on the highlighted line | - |
| A0-9 | any page; Ctrl K, type three letters of a test guest on today's Arrivals | Reception | 1280 × 800 | 1 the "Bookings" heading · 2 one booking line (name, reference, dates, room) · 3 its status word, right | - |
| A0-10 | `/` | General Manager | 375 × 812 | 1 menu button ☰ · 2 magnifying glass · 3 bell · 4 avatar | - |
| A0-11 | `/`, tap ☰ | General Manager | 375 × 812 | 1 the space switcher at the top of the drawer · 2 the menu · 3 Find a screen at the drawer's foot | - |
| A0-12 | `/h/5EL/arrivals` | Reception | 375 × 812 | 1 Today / Upcoming switch · 2 a card's room and status · 3 guest and reference · 4 the labelled rows | At least one arrival on the business date |
| A0-13 | `/h/5EL/stay` | Reception | 1280 × 800 | 1 the yellow bar "No connection. Working offline…" · 2 the line "No connection - these rooms are as they were at …" | Load Rooms, stop the api, open Arrivals and come back; restart the api after |
| A0-14 | `/h/5EL/housekeeping` | Housekeeping | 1280 × 800 | 1 the bar "No connection. 1 change held: Housekeeping. They go when the line is back." | Stop the api, tap the sparkle on a dirty room; restart the api after (it sends by itself) |

## Chapter A1 - The front desk day

| Id | Address | Sign in as | Size | Callouts (arrow → what) | Before taking it |
|---|---|---|---|---|---|
| A1-1 | `/h/5EL/arrivals` (any screen) | General Manager | 1280 × 800 | 1 the yellow line under the top bar · 2 its "Night audit" link | Only while the business date is behind the real date; otherwise drop the figure |
| A1-2 | `/` (top of page) | General Manager | 1280 × 800 | 1 "Business date · …" · 2 hotel name · month so far line · 3 the four tiles · 4 a "· n left" · 5 the dark Occupancy card · 6 ARR, RevPAR, Room revenue · 7 one (i) button | Best with an arrival still to come and a departure owing, so yellow and orange show |
| A1-3 | `/`, scrolled down | General Manager | 1280 × 800 | 1 Nights ahead, on "Tonight" · 2 Money · 3 the arrow by No-shows · 4 The house now and its key · 5 Quick reports | - |
| A1-4 | `/` | Reception | 375 × 812 | 1 the tiles, two across · 2 the Occupancy card | Put Start here away first (Got it), bring it back after |
| A1-5 | `/h/5EL/arrivals` | Reception | 1280 × 800 | 1 Today / Upcoming · 2 "n expected" pill · 3 the search box · 4 "n of m" · 5 table / cards buttons · 6 a guest name with its reference · 7 a "Due in" status | Table view; a few arrivals, one still due in |
| A1-6 | `/h/5EL/arrivals`, click a Due in row | Reception | 1280 × 800 | 1 name, reference, phone · 2 orange Check in · 3 More options · 4 Stay and Bill tabs · 5 the Room line · 6 Charged / Paid / Balance at the foot | - |
| A1-7 | `/h/5EL/in-house`, click a guest, open More options | Reception | 1280 × 800 | 1 the list under "The booking" · 2 a greyed option with its reason | - |
| A1-8 | `/h/5EL/in-house` | Reception | 1280 × 800 | 1 In house now / Due out switch with counts · 2 "n rooms" pill · 3 the Balance column on a red and a green figure | Table view |
| A1-9 | `/h/5EL/in-house/due-out` | Reception | 1280 × 800 | 1 the line "… Check-out unlocks when the bill reaches zero." · 2 the red "still owing" box · 3 a row with a red balance | A departure today with money owed |
| A1-10 | `/h/5EL/in-house`, click a guest due out (Stay tab) | Reception | 1280 × 800 | 1 orange Settle and check out · 2 the Bill tab · 3 the amount at the foot | - |
| A1-11 | `/h/5EL/stay` | Reception | 1280 × 800 | 1 Calendar / Rooms switch · 2 Room type / Floor · 3 Assign room · 4 the count tiles · 5 an In house tile · 6 a Due out tile ("out today") · 7 a Free tile and its arrow · 8 a room type heading and count | Put Start here away first, bring it back after |
| A1-12 | `/h/5EL/stay` | Reception | 375 × 812 | 1 the count tiles (they scroll sideways) · 2 the tiles, two across | Scrolled past Start here |
| A1-13 | `/h/5EL/calendar` | Reception | 1280 × 800 | 1 ‹ › week arrows · 2 the date range (and Today) · 3 the bar key · 4 the dark business-date column · 5 a room type row · 6 a booking bar · 7 an empty cell · 8 a room's sparkle and spanner · 9 Available / Occupancy at the foot | Put Start here away first, bring it back after |
| A1-14 | `/h/5EL/calendar`, rest the mouse on an In house bar | Reception | 1280 × 800, cropped to the bar | 1 the guest's name · 2 dates and nights · 3 price per night and balance | - |
| A1-15 | `/h/5EL/calendar` | Reception | 375 × 812 | 1 three nights and the edge of the fourth · 2 the room column | - |

29 pictures: 14 in A0 (10 desk, 4 phone), 15 in A1 (12 desk, 3 phone).

## Not possible with the demo as it is

- The account menu's **Property list** and the Dashboard's **Property** box show
  only for somebody who works at more than one property. The local demo has one
  (5EL), so A0-5 shows the single property and A0.5 has no picture of the list.
  Whether to add a second made-up property for these is the owner's question.
