# Restaurant (POS)

The hotel's own restaurant till — tables, orders, the kitchen pass, the menu,
closing the restaurant day — and the door an outside till uses to charge a
bill to a guest's room.

**Folder name:** `pos` — the same word in all three places:

```
src/modules/pos/          the screens, their data calls, their tests
api/src/modules/pos/      the server's routes for this service
db/tests/modules/pos.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: claim the service with `npm run claim -- pos "what"`
(since 16 September's evening — the `.claims/pos.md` file this line used to
name was visible only in the copy that wrote it, root MEMORY 281), read
`docs/briefs/pos.md`, this file, then this
folder's `DEFECTS.md` and `CHANGELOG.md`. Written 15 September 2026 from the
code at `880a5b6`.

---

## What it is

A waiter taps a table, adds dishes on a pad and sends the round to the
kitchen. The kitchen sees each dish on a wall screen and moves it along —
started, ready, served — by stage or by table. When the guest leaves, the
bill is settled: cash, card, UPI, split, or charged to their room. At the end
of the night somebody counts the drawer and closes the restaurant day. The kitchen
manager keeps the menu: dishes, prices, preparation times, courses, what is
off today, and named promotions.

Separately, an **outside till** (a machine with a key, not a person) can ask
which rooms it may charge and post a finished bill to a guest's folio. The
"Charges to rooms" screen shows everything such a till sent, refusals
included. The contract for that door is `docs/POS-INTEGRATION.md`.

---

## Screens

The menu section is **Point of sale**. It is absent at a property whose `pos`
module is off, and absent for Reception where "Reception can use the POS" is
off (`navigation.ts`, section `point-of-sale`, `receptionNeeds: "reception_pos"`).

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Tables | `/h/:code/floor` | `pages/Floor.tsx` | waiter (`pos`), Reception |
| Till | `/h/:code/till` | `pages/Till.tsx` | waiter, Reception |
| Terminal | `/h/:code/till/terminal` | `pages/Terminal.tsx` | waiter, Reception |
| Kitchen | `/h/:code/kitchen` | `pages/Kitchen.tsx` | chef, kitchen manager |
| Menu | `/h/:code/menu` | `pages/Menu.tsx` | kitchen manager |
| Close restaurant day | `/h/:code/till/day-end` | `pages/DayEnd.tsx` | waiter, kitchen manager, Reception |
| Charges to rooms | `/h/:code/pos` | `pages/Pos.tsx` | none |
| Restaurant setup | `/h/:code/till/setup` | `pages/Setup.tsx` | none - the owner, an administrator and the GM see it (`room_config` edit; D22-6, D25-20 to D25-26, 25 Sep) |
| — (not in the menu) kitchen docket | none since 29 Sep | `components/DocketSlip.tsx` | printed by the outlet's KOT station alone (D27-159, D27-161); the page every send opened in a new tab (D17-18) is retired; never shows prices |
| — KOT printer panel | on the Kitchen screen | `components/KotStation.tsx` | "This device prints KOTs" with a typed name, for the owner, an administrator, the GM and the kitchen manager; on the station, the last 20 KOTs with Reprint |
| — (not in the menu) printed bill | `/h/:code/till/bill/:id` | `pages/Bill.tsx` | opened from an order |

- Reception's four entries show only while the hotel's "Reception can use the
  POS" switch is on.
- Owner, admin, GM, hotel manager, finance and read-only have no working menu;
  they see every entry their permissions allow. Who may see each entry is the
  `canSee` beside it in `nav.ts` (Tables, Till, Terminal: the `payment` grant
  or the waiter role; Kitchen: `payment`, chef or kitchen manager; Menu: the
  `rate` grant or kitchen manager; Close restaurant day: `payment`, waiter or
  kitchen manager; Charges to rooms: the `invoice` grant; Restaurant setup:
  `room_config` edit - owner, admin, GM).
- `components/PosGate.tsx` wraps Tables, Till, Terminal, Kitchen, Menu and
  Close restaurant day, and Restaurant setup (which also sits in
  `RequireAccess`). It asks the server `GET /till/access` first and shows
  the server's own sentence when the answer is no (MEMORY 251). Docket, Bill
  and Charges to rooms are not wrapped.
- Dialogs and panels in `flows/`: `OrderPad.tsx` (the pad over the floor),
  `DishDialog.tsx` (variations, sides, a note - and since 21 September each
  group's "choose 1 to 2", Add held until it is met; opened by Tables, the Till
  and the Terminal), `OrderHeaderPanel.tsx` (covers, waiter, customer, order type).
- **The Menu screen, 21 September (D21-40 to D21-43), and 30 September
  (D27-189, D27-192, D27-195):** "Add variation" / "Change variations" on each
  dish opens ONE form for all its variation types - Size, Quantity, or an
  Option with the manager's heading ("Crust"); picking a type fills in the
  choice names when its list is empty, never a price; the first type's prices
  are the dish's, a further type's add to it; each choice is priced or ticked
  Free; removing every type asks for the dish's own price. Under the dish, one
  line per type ("Size: Small ₹200 · Large ₹400", "Crust: Cheese burst +₹80 ·
  Thin Free"); a dish with variations shows "-" for its own price. An
  **Add-on groups** section - each group's rule, its options with Change and
  Remove, "Add option" (a price or Free), "Dishes" to choose which dishes
  offer it; **Import add-ons** and **Import the menu**, two files, add-ons
  first. A blank price is refused, and a 0 unless ticked Free (D27-120; a file
  cannot tick Free, so a file's 0 is refused).
- **The dish pop-up (`DishDialog`)**: one row per variation type under its
  heading ("Variation" for a type carried over from before 30 September, until
  the manager picks one); a later type reads "+₹80" or "Free"; Add waits for
  one choice in every type and each group's add-on rule.
- **The same dish again is one more of it (D27-189, POS-27):** on Tables' pad,
  the Till and the Terminal, a dish with the same variation choices, note and
  sides joins its unsent line; once the kitchen has it, more is a new line
  (D27-148). The Till has a − (a sent dish asks a manager's reason, D27-119);
  sides follow their dish's quantity (POS-28).

---

## Server endpoints — 73 (counted 30 September: 67 in till.ts, 6 in pos.ts)

The code is in `api/src/modules/pos/` (moved 15 September): `till.ts` (the
till, **3,555 lines** — splitting it into parts is not done yet) and `pos.ts`
(the bridge to an outside till). The door `index.ts` mounts them.

**The till** — `/api/hotels`, a person's bearer token. Every `/:code/till/*`
and `/:code/kitchen*` route passes two gates first: the `pos` module must be
on (`app.module_enabled`) and, for Reception, the hotel's reception switch
(`app.may_use_pos`, 087).

```
access      GET    /:code/till/access                       answers ok only past both gates
menu        GET    /:code/till/menu                         a dish's taxRate is the rate it is RUNG at (own, else
                                                            its section's rule; DISH_TAX_RATE in till.ts), null when
                                                            none is set - a dash on screen (D21-94, POS-15); each
                                                            section's taxKind, null when not set (D22-4)
            POST   /:code/till/menu/categories
            POST   /:code/till/menu/items
            POST   /:code/till/menu/import                  "alcohol" as a Tax heading only where the property
                                                            serves alcohol, else the row is refused (D22-46)
            POST   /:code/till/menu/items/:id/course
            POST   /:code/till/menu/categories/:id/course
            POST   /:code/till/menu/categories/:id/tax-kind the section's heading picker (D22-4, 23 Sep):
                                                            restaurant, bar, banquet, other; alcohol only where
                                                            served. The menu's grant (roleGate MENU)
            POST   /:code/till/menu/items/:id/prep
            POST   /:code/till/menu/categories/:id/prep
            POST   /:code/till/menu/items/:id/toggle
            POST   /:code/till/menu/items/:id/off
            POST   /:code/till/menu/items/:id/on
            POST   /:code/till/addons/:id/off              the Menu screen's add-on switch (17 Sep, POS-2)
            POST   /:code/till/addons/:id/on               the Menu screen's add-on switch (17 Sep, POS-2)
variations  PUT    /:code/till/menu/items/:id/variations   the dish's whole set, one transaction (D27-192):
                                                           {types:[{kind, heading?, choices:[{id?, label,
                                                           price, free}]}], dishPrice?, dishFree?}; a choice
                                                           keeps its row by type and name (a removed one
                                                           comes back), else by id; one left out is switched
                                                           off, never deleted; emptying it needs dishPrice.
                                                           Replaced the three per-variation routes, 30 Sep
add-ons     GET    /:code/till/menu/addon-groups           every group, its options and its dishes
            POST   /:code/till/menu/addon-groups           D21-41: name, minSelect, maxSelect
            PATCH  /:code/till/menu/addon-groups/:id       the same three
            POST   /:code/till/menu/addon-groups/:id/dishes  the whole list of dishes offering it
            POST   /:code/till/menu/addon-groups/:id/addons  an option: a name and a TYPED price, or free
            PATCH  /:code/till/menu/addons/:id             rename and reprice, both sent
            POST   /:code/till/menu/addons/:id/remove      switched off, never deleted
            POST   /:code/till/menu/addon-groups/import    the add-ons file (D21-43), dry run first
outlet      POST   /:code/till/outlet/:outlet/closed        "we are closed" for a while
rooms       GET    /:code/till/rooms                        rooms a bill may be charged to
orders      GET    /:code/till/orders
            POST   /:code/till/orders
            POST   /:code/till/orders/batch                 the pad's whole round in one request; eventId (D17-21)
            GET    /:code/till/orders/:id
            PATCH  /:code/till/orders/:id                   covers, waiter, customer, type, held, eventId (D17-21)
            POST   /:code/till/orders/:id/lines
            POST   /:code/till/orders/:id/lines/:lineId/void
            POST   /:code/till/orders/:id/lines/:lineId/qty
            POST   /:code/till/orders/:id/kot               send to the kitchen
            GET    /:code/till/orders/:id/kot/:no           one docket (the kitchen reads it too: KOT_READ)
            POST   /:code/till/orders/:id/kot/:no/printed   {device}: the KOT station's claim before the paper;
                                                            refused unless the device is the station; claimed
                                                            false when another tab has it (D27-159)
kot station GET    /:code/till/kot-station?device=          each own outlet's station: name, mine, last seen, online
                                                            (seen within 90 s, KOT_STATION_ONLINE)
            POST   /:code/till/kot-station/:outlet          {device,name,on}: on moves it here (a name is typed);
                                                            off only from the station (KOT_SWITCH: menu edit)
            POST   /:code/till/kot-station/:outlet/poll     {device}: last seen; to the station only, the due
                                                            dockets (since switched on, unprinted, the business
                                                            date only: CATCH_UP_FROM, D27-167) and the last 20
            POST   /:code/till/orders/:id/printed
            POST   /:code/till/orders/:id/clear
            POST   /:code/till/orders/:id/settle            cash · card · UPI · split · room · function (D17-21)
            POST   /:code/till/orders/:id/abandon
money       POST   /:code/till/orders/:id/discount
            POST   /:code/till/orders/:id/discount/clear
            POST   /:code/till/orders/:id/promotion
            POST   /:code/till/orders/:id/round-off
            GET    /:code/till/promotions
            POST   /:code/till/promotions
            PATCH  /:code/till/promotions/:id
floor       GET    /:code/till/floor
            GET    /:code/till/waiters
day end     GET    /:code/till/day-end
            POST   /:code/till/day-end/movements
            POST   /:code/till/day-end/count
            POST   /:code/till/day-end/close
setup       GET    /:code/till/setup                        D22-6 (25 Sep): the restaurant (the REST outlet), its
                                                            sections - an empty one too - and tables, each table's
                                                            `busy` (a bill on it), and how many have the Waiter role
            POST   /:code/till/setup/restaurant             names REST, or makes it through addOutlet, with no key
            POST   /:code/till/setup/sections               a section of a switched-off name comes back on
            PATCH  /:code/till/setup/sections/:id           rename
            POST   /:code/till/setup/sections/:id/off       switched off, never deleted; refused while a bill sits
                                                            on one of its tables
            POST   /:code/till/setup/sections/:id/tables    one ({ label }) or a run ({ prefix, from, to }), at most
                                                            100; seats optional, null when blank; four to a row
            PATCH  /:code/till/setup/tables/:id             label and seats, both sent
            POST   /:code/till/setup/tables/:id/off         switched off, never deleted; refused while a bill sits
                                                            on it (open, or paid and not cleared)
kitchen     GET    /:code/kitchen
            POST   /:code/kitchen/lines/:lineId/:to
```

**The bridge, machine side** — `/api/pos`, an outlet key in `x-pos-key`
(resolved by the auth gate in `api/src/server.ts` through `outletFor`; refused
when the property's `pos` module is off):

```
GET    /api/pos/rooms
POST   /api/pos/tickets
GET    /api/pos/tickets/:ref          "did my last request land?"
POST   /api/pos/tickets/:ref/void
```

**The bridge, person side** — `/api/hotels`, a bearer token:

```
GET    /api/hotels/:code/pos/outlets   also read by Administration → Settings
GET    /api/hotels/:code/pos/tickets   the Charges to rooms screen
```

Outlet keys are issued by `cd api && npm run pos:outlet` (`api/scripts/pos-outlet.ts`).
The hotel's own restaurant - the `REST` outlet Tables, the Till and Close
restaurant day open - is made on Restaurant setup (25 Sep), with no key. Both
make the row through one function, `addOutlet` in `pos.ts`.

---

## Data

```
data/till.ts        Every call the till, floor, pad, terminal, kitchen,
                    menu and day-end screens make. A WRITE's refusal comes back
                    as { ok: false, reason }, not an exception. A READ that
                    fails THROWS (POS-4, 16 Sep) — never catch it into an
                    empty list; the screen decides what to say.
                    `openOrderOnTable` has no caller — on KNOWN_UNREACHABLE in
                    src/data/repositories/repositories.test.ts ("superseded by the
                    order pad; safe to delete").
data/posBridge.ts   What an outside till sent: listPosOutlets, listPosTickets.
                    Split out of the old billing.ts on 15 September.
lib/addonSpec.ts    ADDON_SPEC - the add-ons file's columns (D21-43). Here and
                    not in `@/lib/importSpec` (the master's), where this lane was
                    granted MENU_SPEC alone; MENU_SPEC gained Variation and
                    Add-on groups the same day.
lib/pricing.ts      unitPriceOf, chosenLabels — the price of ONE dish with its
                    sides, on the client, so the pad can show a running total.
                    The same rule is on the server (addOneLine in till.ts);
                    api/test/padTotal.test.ts prices the same lines both ways.
components/PosGate.tsx   see Screens.
   (what a failed read says — POS-4 — left this folder on 17 September:
    readProblem, ReadFailed and ReadStale are the shared kit's now, in
    `@/components/ui`, one copy for every service. Import them from there;
    every screen here with a read uses one of them.)
components/FunctionPicker.tsx   "Banquet function" (D17-21): banquet's list of
                    functions an order may go on, through its front door; nothing
                    drawn where there is nothing to choose and nothing chosen.
components/KotStation.tsx   the KOT station (D27-159, D27-161): kotDevice() (this
                    browser's id, localStorage `pms.kot-device`); KotStationPrinter,
                    mounted by PosGate, prints every due docket on the station through
                    window.print() (claim first, one at a time); KotStatus, the line
                    on Tables, the Till, the Terminal and the Kitchen; KotPrinterPanel,
                    the Kitchen's switch and Reprint. Setup: KOT-STATION-SETUP.md.
components/DocketSlip.tsx   the 80 mm docket, as the station prints it.
   (SlipNotice.tsx and pages/Docket.tsx went on 29 September: D27-161.)
```

The screens also use core pieces: the live channel (`@/lib/useLiveOrders`,
server `GET /api/hotels/:code/live`, 075), the pad's drafts (`@/lib/draft`),
the offline rules (`@/lib/offline.ts`), the import dialog and `MENU_SPEC`
(`@/lib/importSpec`), and Start here.

---

## Database

Tables this service owns, and the migrations that made or changed them:

```
pos_outlets, pos_tickets                       024_pos_bridge.sql (app.pos_chargeable_rooms,
                                               app.pos_outlet_for_key)
                                               (046_store_and_off.sql: an outlet's closed_until)
  a moved guest listed once, by tonight's room 072_room_tonight.sql (MEMORY 171–173)
pos_menu_categories, pos_menu_items,           028_pos_till.sql
pos_orders, pos_order_lines
  order type, KOT status on the line           034_kot.sql
  discount, round off; pos_order_tenders       038_pos_discount_and_tenders.sql
  percent or fixed discount                    039_discount_percent_or_fixed.sql
  app.pos_order_by_rate — tax split, once      040_pos_by_rate.sql
pos_item_variations, pos_addon_groups,         045_variations_and_addons.sql
pos_addons, pos_item_addon_groups
  an item or add-on off until a time           045, 046
  (045's four tables are WRITTEN by the Menu screen and the two import
   files since 21 September - no migration: a removed variation or option is
   is_active false, because a sold line points at it)
  a variation's type_no, kind, heading;         "several variation types per dish" (30 Sep, 182 for
  a name unique within its type;               now): type 1 carries the price, a later one adds;
  pos_order_lines.extra_choice_ids             045's trigger asks one choice of every type
pos_sections, pos_tables                       047_tables_and_floor.sql
  covers, waiter, customer, held               048_order_header.sql
  kitchen docket numbers                       049_kot_docket.sql
pos_day_ends, pos_cash_movements,              050_day_end.sql  (app.pos_day_end_blockers)
pos_denominations
  pos_orders.event_id — a bill for a function  061_banquet_food.sql (see banquet BQ-1)
  the kitchen's NOTIFY trigger                 075_live_orders.sql
  audit trigger on pos_menu_items              076_approvals.sql
  prep_minutes on dish and category            079_prep_times.sql
pos_line_events — kitchen timings              080_kitchen_timings.sql
pos_kot_prints; pos_outlets.kot_station_*     "one KOT printer per outlet" (29 Sep, 157)
  course on dish and category                  081_courses.sql
pos_promotions                                 083_promotions.sql
  reception_pos switch, app.may_use_pos        087_first_screen_and_reception_pos.sql
  a bill settled to a banquet function         099_pos_settled_to_a_function.sql (D17-21; merged
    (payment method 'function', and it names    with this number — the night-audit chat's went
    the function)                              to 100)
```

Also relied on: `hotel_modules` (041 — the `pos` switch; flipped from
Administration), `tax_rules` and a category's tax kind (067 — finance's), and
`folio_postings` — a bill charged to a room is posted through `pos_tickets`,
the same door an outside till uses (028's header).

Other services point at these tables: `stock_movements.to_outlet` →
`pos_outlets` (stores, 069), and `pos_orders.event_id` → `banquet_events`
(banquet, 061). Change either table's keys and those break too.

**A new migration needs a number claimed in `HANDOVER.md` first.**
`src/test/migrationNumbers.test.ts` fails on two files with one number or a
gap. Take the next after cp6's highest and tell the master, who renumbers at
merge if two lanes took one (the plan's § 7). cp6's highest was 105 on the
evening of 17 September, with the Store chat's 106 waiting to merge — so read
`db/migrations` rather than trusting this line.

---

## Front door

`src/modules/pos/index.ts` exports `unitPriceOf` (from `lib/pricing.ts`).
Nothing imports it through the door today: `api/test/padTotal.test.ts` imports
`@/modules/pos/lib/pricing` directly, on purpose — a server test must not load
the restaurant's screens (commit `3cd6f51`).

The server's door, `api/src/modules/pos/index.ts`, exports `mounts` and
`outletFor`, `hashKey`, `issueKey`, `addOutlet`, `Outlet`. `api/src/server.ts` imports
`outletFor` through it. `api/scripts/pos-outlet.ts` and `api/test/modules/pos/pos.test.ts`
import `hashKey` and `issueKey` through it as well (the script `addOutlet` too).
It also exports `struckAfterKitchen` (28 September), which the night audit reads
for its restaurant figures - the same list Close restaurant day shows.

---

## Leans on

One other service's door is imported by this folder (17 September):

- **banquet** — D17-21. The website reads `getAttachableFunctions` from
  `@/modules/banquet` (`components/FunctionPicker.tsx`); the server asks
  `whyNotAttachable` from `api/src/modules/banquet/index.ts` (`till.ts`) before
  it writes `pos_orders.event_id` and again before it settles to a function.
  The rule (confirmed, bill open, running on the business date) is banquet's;
  the till never keeps a copy. Banquet's function bill counts the till's
  settled orders through `app.banquet_event_total` (061).

- **finance**, at the database: a room charge becomes a folio posting (through
  `pos_tickets`), and a category's tax kind comes from finance's tax rules (067).
- **front desk**, at the database: which rooms can be charged is
  `app.pos_chargeable_rooms` — checked-in stays with an open folio.
- **admin**: the `pos` and `reception_pos` switches live on Administration →
  Settings → Modules.

---

## Rules that bind it

- **Food the kitchen has comes off only for a manager, with a reason** (D27-119
  and the owner's round C answers, 28 September): the owner, an administrator,
  the GM, the hotel manager or the kitchen manager - striking a sent dish,
  lowering its quantity, or closing unpaid a bill any of which was sent
  (`sentStrikeRefusal`, `till.ts`). The reason is `void_reason` (151) and shows
  on the docket, the Kitchen screen, Close restaurant day and the night audit
  (`app.pos_struck_after_kitchen`). More of a sent dish is a NEW line for the
  next docket, never a bigger sent one.
- **Cash is whole rupees; a closed day is closed** (the owner, 28 September): a
  bill paid wholly in cash is rounded at the settle; once Close restaurant day
  has counted the drawer, new bills and payments wait for the night audit.
- **The pass shows paid food** until it is served (QA POS-1); 151 lets only the
  kitchen status change on a settled order.
- **No default prices** (`HANDOVER.md` § 5). The schema ships no dish and no
  price — the hotel types them (`028_pos_till.sql`, header and the comment on
  `pos_menu_items`). A dish with variations has no price of its own; the
  variation carries it (`lib/pricing.ts`). A missing preparation time is
  NULL and shows a dash, never "0 min" (079). A bar item cannot be sold until
  the owner sets a bar tax rule — `app.gst_rate` raises rather than return 0
  (067's header).
- **An order on a banquet function is paid on the function's bill only** — the
  owner's D17-21 and its answers, 17 September. Staff choose the function when
  ordering, on Tables, the Terminal and the Till (`components/FunctionPicker.tsx`,
  shown only where banquet offers a function or the order is already on one).
  Such an order settles "to the function" (payment method `function`, 099) and
  no other way: the server refuses cash, card, UPI, a room and a split for it
  with a sentence, and the screens show those switched off with the reason. It
  may be taken off the function while open. Nothing is posted to a folio — the
  function's bill is banquet's sum, which counts the order once it is settled —
  and the drawer does not expect it; Close restaurant day lists it as "To a
  function".
- **"Reception can use the POS"** — the owner's per-hotel switch, 14 September:
  on at 5 Elements, off for a hotel added later (`HANDOVER.md` § 4; 087).
  Enforced twice: the menu hides the section, and `till.ts` refuses with a
  sentence. Only the property's GM or a group administrator may flip it
  (084, MEMORY 250).
- **Working menus**, owner's lists of 15 September (`HANDOVER.md` § 3.2):
  waiter — Tables, Till, Terminal, Close restaurant day; chef — Kitchen;
  kitchen manager — Kitchen, Menu, Close restaurant day; Reception adds the
  four when the switch is on. The restaurant roles could not see their own
  screens until then (MEMORY 260). A new screen goes into the right working
  menus or it is search-only for those roles.
- **Start here** (15 September). `src/components/app/startHereCards.ts` lines
  60–77 are the waiter's card (open a table, Send, settle — naming "Send" and
  "Charge to room") and the chef's (naming "Start" and "Ready"). Lines 85–86
  place the card on Tables, Till and Kitchen. Rename one of those buttons and
  change the card too (`HANDOVER.md` § 3.3).
- **A room charge may be held with the line down; money may not.** The
  owner's decision of 8 September: a waiter can charge a room offline and it
  must reach the server before anything closes (MEMORY 199, 200). Cash, card
  and UPI settlements and the day end are refused offline
  (`src/lib/offline.ts`). The day end refuses while any bill is still open
  (050, `app.pos_day_end_blockers`). The risk the owner accepted: a guest can
  check out while a charge is still held; the outbox keeps the refusal and
  shows it (MEMORY 200). The rooms list is kept on the device (owner, 8 Sep —
  CHANGELOG "A room charge with the line down").
- **The pad's running total** is the dishes' cost, not the bill; tax and
  rounding come only from the server (owner, 8 September — CHANGELOG
  "Deploy to production, then Stage C"). The rule lives in two places, so
  `padTotal.test.ts` must stay (MEMORY 195).
- **Discounts**: a free hand up to 10%; anything more is a named promotion the
  till applies (owner's words in `083_promotions.sql`; commit `1890b67`,
  9 September). The cap is the database's number,
  `app.pos_freehand_discount_cap()` (083), and the discount route reads it.
  This replaced the planned approval queue.
- **No privileged path to the ledger.** Settling to a room goes through
  `pos_tickets` like an outside till (028, `till.ts` header). A posting carries
  one tax rate, so a mixed bill posts one row per rate (MEMORY 55). The
  business date is the hotel's, not the till's clock (024's header; MEMORY 19).
- **One KOT printer per outlet** (D27-159, D27-161, D27-167, 29 September):
  the device switched on as the outlet's KOT station prints every KOT, and no
  other device opens or offers one. Switching it on elsewhere moves it; only
  the station switches itself off. It prints while a restaurant screen is
  open on it (PosGate); missed KOTs print when it is back, oldest first, the
  business date's only. Tables, the Till, the Terminal and the Kitchen say
  whether KOTs are printing. The Till sends to the kitchen like the Terminal
  (D27-166, POS-24).
- **The kitchen hears from the database**: a trigger raises the live
  notification (075). Do not publish from routes (MEMORY 181).
- **Words**: "Order 12", not "KOT 12", on screen; the printed kitchen slip
  keeps KOT (`HANDOVER.md` § 6, 15 September). "Tables", not "Floor" — Floor
  also names the Rooms screen's grouping by floor (CHANGELOG 2026-09-15
  step 3; the comment in `pages/Floor.tsx`).
- **Every list draws four states** — loading, failed, empty, full
  (`HANDOVER.md` § 6; MEMORY 269). **A new dialog must declare its main
  action** — `src/components/ui/primaryAction.test.ts` (`HANDOVER.md` § 3.1).
- **Inside `withSession`, a refusal is a commit** — every refusal before the
  first write, or throw (MEMORY 243). The till's routes have not been checked
  for this (PENDING § 2).
- **The server runs with types stripped**: no parameter properties, enums or
  namespaces. One in `till.ts` took the live API down (MEMORY 209).

---

## Open items

From `PENDING.md` and `PROGRESS.md`, as of 15 September:

- **The menu and tables are the demo's** — 17 items, 20 tables — and real
  bills are rung against them. The owner's to confirm or replace (PENDING § 2;
  PROGRESS "Still needing a person" 4).
- **Terminal's send action is not marked** — `Terminal.tsx` draws its own
  touch buttons, outside `primaryAction.test.ts` (PENDING § 5a).
- **The kitchen manager's list has no Store** — approved as listed; worth
  asking the owner (PENDING § 5a).
- **The waiter's and chef's Start here cards are proved by tests only** — no
  local waiter or chef sign-in (PENDING § 5a).
- **`pos_promotions` has no validity dates** — deliberate, not asked for
  (PENDING § 6). It is also one of three tables owned by `postgres` instead of
  `pms_migrate`; a migration run as `pms_migrate` that alters it will fail
  (PENDING § 6).
- **"Which room was this stay in" is written by hand** in
  `api/src/modules/pos/pos.ts` (the tickets list) — one of seven copies that could
  move onto `app.stay_room()` (PENDING § 6).
- **`openOrderOnTable`** has no caller (PENDING § 4).
- Found while writing this brief (15 September), not yet elsewhere:
  - Bill, Docket and Terminal set no browser-tab title — none uses
    `PageHeader` or `useDocumentTitle`. Kitchen does since 16 September (POS-3).
  - `pages/Pos.tsx` renders two `PageHeader`s, "Charges to rooms" and lower
    down "Bills"; each sets the tab title. Which one the tab shows was not
    checked on screen — unverified.
- **D17-21 is built (17 September) — see "Rules that bind it".** Left from it:
  settling to a function with the line down gets the shared offline sentence
  "…unless it is charged to a room" (`@/lib/offline.ts`, the core's) — true,
  but it does not name the function. (The other one, a function chosen on
  Tables being forgotten when the pad closed, is fixed: the master put
  `eventId` on the core draft and the pad restores it, 17 September.)

---

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit     clean
          cd api && npm test             a scratch database; never `npx vitest run`
                                         inside api/ (MEMORY 196, 221, 264)
          cd api && npm run strip-check  the server's loader can parse every file (MEMORY 209)
database  db/tests/run.sh                a scratch database, dropped after
```

The guard this folder must respect: `src/test/boundaries.test.ts` — another
service reaches this one only through `index.ts`, and this one reaches others
only through theirs.

Where the checks are today: server tests `api/test/till.test.ts`,
`tillBatch.test.ts`, `pos.test.ts`, `padTotal.test.ts`,
`roomChargeOffline.test.ts`, `prepTimes.test.ts`, `kitchenTimings.test.ts`,
`courses.test.ts`, and blocks in `guards.test.ts` ("the module gate") and
`firstScreen.test.ts` ("reception on the POS, per hotel") — moving to
`api/test/modules/pos/` (there since the move: `functionOrders.test.ts`, the
till's half of D17-21 against banquet's real rule — 17 Sep). Web:
`src/modules/pos/readStates.test.tsx`
(refused, failed and empty on the till's reads; the two dates; the Kitchen
heading — 16 Sep), `src/modules/pos/ownerDecisions.test.tsx` (the owner's
D17-18, 19 and 20: Tables opens the kitchen slip; add-on switches on the Menu
screen; Close restaurant day's date and hotel name; POS-10 and POS-11 —
17 Sep), `src/modules/pos/functionOrders.test.tsx` (D17-21 on Tables, the
Terminal, the Till and the day end — 17 Sep), `src/App.test.tsx` ("the till in the
navigation", "point of sale as a category", "start here"),
`src/components/app/navigation.test.ts`, `src/lib/offline.test.ts`. Database:
`db/tests/suite.sql` groups `pos`, `pos till`, `pos discount`, `kot`,
`variations`, `floor`, `covers`, `day end`, `kitchen timings`, `prep times`,
`courses`, `promotions`, `reception pos` (frozen — new checks go in
`db/tests/modules/pos.sql` — "pos function", 8 assertions, 17 Sep).

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.
