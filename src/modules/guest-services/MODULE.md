# Guest services

**In-stay requests**: towels, a broken tap, a pot of tea. Raised by the desk
or by the guest from their own page, done by the team they are for, from open
to done, with who took each and how long it took. Built 30 September 2026
(D27-178; the owner's answers D27-181).

```
src/modules/guest-services/          the screen, its menu entry and address, its data, its test
api/src/modules/guest-services/      the three routes, and who is on which team
db/migrations/172_a_guests_request_is_a_work_order.sql   (number for now; refer to it
                                     as "a guest's request is a work order")
db/tests/modules/guest-services.sql  the guest page's three functions, called directly
```

---

## The one idea: a request is a work order for a stay

Housekeeping's `work_orders` (058) already hold a room, what, a category,
open -> in progress -> done or cancelled, who has it, who closed it, when and
what was done. A request is one of those that also carries the stay
(`reservation_id`), and `raised_by_guest` when the guest asked from their own
page. No second table and no second set of states.

| Team (what a person picks) | Stored as `category` | Who receives it (D27-181) |
|---|---|---|
| Housekeeping | `housekeeping` | housekeeping |
| Something broken | `maintenance` | whoever updates a repair today (D22-34): owner, admin, GM, hotel manager, Inventory Manager, housekeeping |
| Food and drink | `fnb` (new in 172) | kitchen manager, chef, waiter |

**The desk** (owner, admin, GM, hotel manager, reception) sees every team's
and may take, close or cancel any. A team sees and acts on its own. Anybody who
sees the screen may raise one. Everybody else is refused (403, one sentence).
The server's list is `teamsFor` in `api/src/modules/guest-services/requests.ts`;
the website's copy is `requestRoles.ts`; the API test holds them together, and
holds "something broken" to housekeeping's `REPAIR_UPDATERS`.

**Something broken is a repair**, so it also shows on housekeeping's Work
orders and goes into the room's repair history; closing it asks what was done.
Housekeeping and food-and-drink requests stay off Work orders (its
`NOT_A_GUEST_REQUEST` filter) and close with one tap (`resolution` "Done").
A cancel asks why, for every team.

**No time targets (D27-181).** Each request shows how long it has waited, or
how long it took (`closed_at - raised_at`). Nothing turns red.

**Food and drink carries no price.** The request is the ask; anything
chargeable is still rung on the Till and charged to the room.

---

## Screens

| Menu name (section) | Address | Page file | Working menus |
|---|---|---|---|
| Guest requests (Front desk) | `/h/:code/requests` | `pages/Requests.tsx` | reception, housekeeping, kitchen manager, chef, waiter |

Open, and Done in the last 24 hours; a team filter when the person sees more
than one team; each request with its room, the guest's name (only for a role
that reads guests), "from the guest's page" or who raised it, how long, who has
it. **Take it**, **Done**, **Cancel it**; **New request** (the one primary
action) is one dialog: room (who is in house now), team, what, when. Reads
again every 30 seconds. Four states. Its Coming soon page is gone.

**The guest's page** (online-checkin's `GuestPage.tsx`): while the stay is
checked in, "Ask for something" offers Housekeeping, Something broken and Food
and drink beside the spa and laundry, and lists the guest's own requests as
Open, Being done, Done or Declined. What the desk raised for them is not shown.

**The bell** (`api/src/routes/notifications.ts`): "{n} guest requests
waiting" - open and not taken - for the team that receives them and for the
desk, linking here.

## Server endpoints (`api/src/modules/guest-services/requests.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/hotels/:code/requests?view=open\|done` | the person's teams' requests (done: closed in the last 24 h), and who is in house for the dialog |
| POST | `/api/hotels/:code/requests` | `reservationId`, `team`, `what`, `when`; refused unless that guest is checked in now |
| PATCH | `/api/hotels/:code/requests/:id` | `action`: `take` (in progress, mine), `done` (a `note` required for something broken), `cancel` (a `note` required) |

Each is `own` in `api/src/roleGate.ts` (the route decides by the request's
team), pinned in `roleGate.test.ts`. Names come through `app.colleague_name`,
never an inner join on `staff` (root MEMORY 283).

## Database (172)

- `work_orders.reservation_id`, `work_orders.raised_by_guest`; the `fnb`
  category; a guest's request always names its stay and no member of staff.
- `app.work_order_room_is_here()` also refuses a stay at another property.
- The guest page's functions, bodies only (root MEMORY 317):
  `app.guest_link_open` offers the three kinds while checked in;
  `app.guest_request_make` writes them as work orders in the stay's room, ten
  open at most for the stay counting both tables; `app.guest_requests_mine`
  lists them. `guestDoor.ts` did not change.

## Not built, on purpose

- Wake-up calls and lost property (the old Coming soon page named them):
  not part of D27-178.
- Offline: a request is not held when the line is down (`src/lib/offline.ts`
  does not list `/requests`), so it is refused at once. Add it there if the
  owner wants the housekeeper's phone to queue them.
- A New request button on the stay panel (front desk's file).

## Requests from other services

None.
