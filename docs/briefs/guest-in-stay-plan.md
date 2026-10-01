# The guest's in-stay page, after the launch: the plan (D27-221; 1 October)

Planned read-only on 1 October, before any build. Assumes the in-stay requests job (migration
170) and the kitchen's two buttons are merged. Nothing here is decided beyond D27-221: the
**owner questions** below come first.

## Step 0 (the master, ~30 min, no behaviour change)
Move the door's helpers (`sha256`, `ask`, `openedHere`, `refused`) from `api/src/routes/guestDoor.ts`
into `api/src/routes/guestDoorKit.ts`, and GuestPage's `SECTION`, `H2`, `useUnlockGone`,
`messageFrom` into `src/modules/online-checkin/guestKit.ts`. Then each lane has its own route
file (one mount line in guestDoor.ts) and its own section file (one line in `Behind`).

**Every new guest route keeps the door's rules**: the stay only from `app.guest_unlocked` inside
a definer taking (token hash, unlock hash); no stay/room/folio/table id from the caller; a db
test with the link hash and no unlock; refusals look like an unknown link; the guest taps, the
only typing is a note. **Nobody replaces `app.guest_link_open` again** (lanes would wipe each
other): each section asks its own function and hides itself when empty.

## A. In-room dining from the menu
Builds on: `POST /till/orders/batch` (addOneLine, fireKot, all-or-nothing), `DishDialog`,
`lib/pricing.ts`, `room_service` orders, `app.pos_chargeable_rooms`.
The guest's order is a SUBMISSION a person accepts (a folio line is on the tax invoice).
Migration: `guest_food_orders` (stay, basket jsonb, note ≤200, waiting/accepted/declined/cancelled,
the POS order it became, reason, who, when; RLS). Functions: `guest_menu` (checked in, POS on,
REST open; no dish off, no alcohol, none unpriced), `guest_food_order_make` (qty 1-20, ≤30 lines,
≤3 waiting), `guest_food_orders_mine`, `guest_food_order_cancel` (while waiting).
Door: `GET /:token/menu`, `GET|POST /:token/orders`, `POST /:token/orders/:id/cancel`.
Staff: `pos/components/GuestOrders.tsx` on the Terminal; Accept and send (the batch route,
`orderType: room_service`, the guest order accepted in the same transaction) or Decline with a
reason; then Start/Ready, Taken, Charge to room as any order. Whoever may ring the till; a bell.
Owner questions: show prices (rec yes, "GST added on your bill"); payment (rec charge to room
only); when charged (rec the waiter's Charge to room at delivery); room-service hours (rec none
at first: off while the restaurant or its day is closed); alcohol (rec left out).
Smallest first: menu, basket, waiting/accepted/declined.

## B. Two-way messages with the desk
Builds on guest_requests kind 'desk' (121/132), `MessagesToTheDesk.tsx`, the bell.
Migration: `guest_desk_replies` (stay, text ≤500, who, when; RLS); `guest_desk_thread`.
Door: `GET /:token/messages` (re-read every 30 s while visible). Staff: `POST .../online-checkin/
messages/:reservationId/reply` for DESK_ROLES, marking the stay's open messages handled; a reply
box on Guest messages.
Owner questions: who replies (rec DESK_ROLES); the name the guest sees (rec "Front desk"); a
WhatsApp "the desk replied" (rec not at first); replies after check-out (rec refused).

## C. One-tap choices (needs 170)
No migration, no route. Tiles above the free text in `RequestsSection`: Housekeeping - Drinking
water, Fresh towels, Toiletries, Clean my room (a 1-4 stepper); Something broken - AC, Plumbing,
Power/lights, TV/Wi-Fi; "Something else" opens today's text box. About a day.
Owner questions: the exact list (rec the above, fixed in code); amenities free (rec yes;
chargeable things stay on the Till, D27-181); finer fault types (rec no).

## D. Table booking
Migration: `table_bookings` (outlet, stay, party 1-20, time, note, requested/confirmed/declined/
cancelled, optional table, answer, who; RLS) and two booking-hours columns on `pos_outlets`
(unset = not offered); `guest_table_offer` (the stay's nights × half-hour slots in the hotel's
zone), `guest_table_book` (≤3 open), `guest_table_bookings_mine`, `guest_table_cancel`.
Staff: `pos/pages/TableBookings.tsx` + `api/src/modules/pos/tableBookings.ts` (Today, Upcoming;
Confirm with an optional table, Decline with a reason); hours set on Restaurant setup; a bell.
Owner questions: capacity rules (rec none, a person confirms); the lunch and dinner windows and
slot length (the owner's figures); which dates (rec any night of the stay); outside diners (rec
not in this job).

## Lanes
After step 0, A, B, C, D run in parallel (A: till.ts batch + Terminal + new files; B:
MessagesToTheDesk + desk data + staff message routes; C: RequestsSection only; D: new files).
The master merges the shared append-only lines (guestDoor mounts, Behind, roleGate,
notifications, server.ts, pos/index.ts) and numbers the migrations. A starts after the kitchen's
two buttons merge (both touch till.ts and Terminal.tsx).
