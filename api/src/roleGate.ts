import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { withSession } from "./auth.ts";
import { ROLES, can, type Action, type Resource, type Role } from "./permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY WRITE — THE SERVER ASKS THE ROLE, ON EVERY WRITE (PMS-2)

   Row level security answers "which hotel". Until 22 September nothing on
   the server answered "which role": any rostered person, a Viewer included,
   could make bookings, guests, bills and prices, because the role matrix
   lived only in the website (the readiness audit of 15 September, PMS-2).
   The owner's D21-88: fix it before 5 Elements' first real day.

   One gate, mounted once in server.ts, in front of every router. For each
   write it finds the route that will answer, looks it up in WRITE_RULES
   below, and asks the person's role at the hotel named in the address:

     grant   the matrix (api/src/permissions.ts, the website's own) must give
             the role this action on this resource - plus any role named in
             `also`, each one there for a reason written beside it
     own    the route already decides who, in its own words; the gate lets
             every role through so that answer is unchanged
     self    a person's own settings, which belong to no hotel

   The role is read the way the website reads it (`useRole`): a group
   administrator is the owner everywhere; anybody else has the role their
   staff_hotels row gives them AT THIS HOTEL. Nobody rostered here passes
   through, and the route answers "No such property" exactly as before.

   A refusal is 403, one sentence naming who may, and nothing is written:
   the gate runs before the route does (root MEMORY 243 cannot bite here).

   AND SINCE 28 SEPTEMBER EVERY READ TOO (READ_RULES, below; RO-1, A7).

   ⚠ A WRITE ROUTE MISSING FROM WRITE_RULES IS REFUSED FOR EVERYBODY. A new
   route cannot slip past by being new, and api/test/roleGate.test.ts fails
   before it gets that far: it lists every write the server mounts and names
   any that is not here.

   THE DOORS THAT HAVE NO PERSON are not this gate's (server.ts): the guest's
   page (/api/guest - a link, hashed), an outside till (/api/pos - an outlet
   key, whose service account is scoped by what the key opens) and SU's push
   (/api/channel - SU's key, checked in the channel manager's door).
   ══════════════════════════════════════════════════════════════════ */

type Grant = {
  readonly kind: "grant";
  /** One resource, or - for a read several screens share - any of several:
      the role needs the action on one of them. */
  readonly resource: Resource | readonly Resource[];
  readonly action: Action;
  /** Roles let in by name beyond the matrix. Every use says why. */
  readonly also: readonly Role[];
  /** What the person was doing, for the sentence: "Making a booking". */
  readonly doing: string;
};

export type Rule =
  | Grant
  | { readonly kind: "own"; readonly where: string }
  | { readonly kind: "self" }
  /* A read every person rostered here needs, whatever their role: the
     property's name, the room list. Row security still answers "which
     hotel"; `why` says why it is nobody's in particular. */
  | { readonly kind: "anyone"; readonly why: string };

const grant = (
  resource: Resource | readonly Resource[], action: Action, doing: string,
  also: readonly Role[] = [],
): Grant => ({ kind: "grant", resource, action, also, doing });
const own = (where: string): Rule => ({ kind: "own", where });
const SELF: Rule = { kind: "self" };
const anyone = (why: string): Rule => ({ kind: "anyone", why });

/* ── The rules, one per kind of act ────────────────────────────────── */

/* Bookings, stays and functions: `reservation`. */
const BOOK = grant("reservation", "create", "Making a booking");
const WALK_IN = grant("reservation", "create", "Checking in a walk-in");
const CHANGE_BOOKING = grant("reservation", "edit", "Changing a booking");
const CHECK_IN = grant("reservation", "edit", "Checking a guest in");
const CHECK_OUT = grant("reservation", "edit", "Checking a guest out");
const ROOMING = grant("reservation", "edit", "Giving a booking a room, or moving it");
const VOID = grant("reservation", "cancel", "Voiding a booking");
const GUEST_PAGE = grant("reservation", "edit", "Making a guest's own page");
const FUNCTION_BOOK = grant("reservation", "create", "Booking a function");
const FUNCTION_CHANGE = grant("reservation", "edit", "Changing a function");
const FUNCTION_CANCEL = grant("reservation", "cancel", "Cancelling a function");
/* ── Round E (BQ-1, 28 September): a function's bill ─────────────────
   The owner's D27-132: the owner, an administrator and the GM take an
   advance, bill the function and settle it - `approve` on a booking is
   exactly those three; the tax invoice also the accountant - `approve` on
   an invoice is exactly those four (D22-33). */
const FUNCTION_MONEY = grant("reservation", "approve", "Taking money for a function, or billing it");
const FUNCTION_INVOICE = grant("invoice", "approve", "Issuing a function's tax invoice");

/* Guests: `customer`. */
const GUEST = grant("customer", "edit", "Changing a guest's record");
const FORM_C = grant("customer", "edit", "Recording Form III");
/* D25-38: guests' passport, visa and ID details are READ only by the people
   who check guests in - the owner, an administrator, the GM, the hotel manager
   and reception. Exactly who may record Form C, so one grant answers both. */
const GUEST_ID = grant("customer", "edit", "Reading guests' passport and ID details");

/* System health (D27-91): the owner and an administrator - exactly `role`
   view today, and api/test/modules/admin/systemHealth.test.ts fails if that
   ever changes. The database asks the same two (app.reads_system_health). */
const SYSTEM_HEALTH = grant("role", "view", "Reading the system's health");

/* Bills: `invoice`. Money taken: `payment`. */
const CHARGE = grant("invoice", "create", "Adding to a bill");
const CHANGE_BILL = grant("invoice", "edit", "Changing a bill");
const TAX_INVOICE = grant("invoice", "create", "Issuing a tax invoice");
/* The owner's D22-33: the owner, an administrator, the GM and the accountant -
   no longer reception or the hotel manager. `approve` on an invoice is exactly
   those four in the matrix. */
const CREDIT_NOTE = grant("invoice", "approve", "Issuing a credit note");
/* D22-44: a VAT bill is cancelled like a credit note, by the same four. */
const VAT_CANCEL = grant("invoice", "approve", "Cancelling a VAT bill");
/* The night audit posts the night's room charges to every bill in the house,
   so it is asked the question a charge is asked - the owner, an administrator,
   the GM, the hotel manager, reception and the accountant, as it is (D22-36). */
const CLOSE_DAY = grant("invoice", "create", "Closing the day");
/* Correcting a closed day: the owner, an administrator and the GM, the people
   who may waive a charge (the owner's D24-3) - `approve` on a booking is
   exactly those three. The database asks the same three (134). */
const CORRECT_DAY = grant("reservation", "approve", "Correcting a closed day");
const PAYMENT = grant("payment", "create", "Taking a payment");
const DRAWER = grant("payment", "create", "Running the cashier's drawer");

/* Rooms on the floor: `inventory`, which reception and housekeeping hold. */
const ROOM_STATE = grant("inventory", "edit", "Changing a room's status");
const OUT_OF_SERVICE = grant("inventory", "edit", "Taking a room out of service, or back");
const HOUSEKEEPING_ROUNDS = grant("inventory", "edit", "Giving rooms to housekeeping");

/* Setting the hotel up: `room_config`, which the matrix gives the owner, an
   administrator and the GM (the owner's D22-30, in the matrix itself). */
const SETUP_ADD = grant("room_config", "create", "Setting the hotel up");
const SETUP_CHANGE = grant("room_config", "edit", "Changing the hotel's setup");
const HALLS = grant("room_config", "edit", "Setting up the banquet halls and packages");
/* A16, the owner's answer of 26 September: the owner, an administrator or
   the GM - the people who set the hotel up. */
const FSSAI = grant("room_config", "edit", "Setting the FSSAI licence number");
/* The group's name and logo (D27-53, D27-65): the owner, an administrator or
   the GM, the owner's answer of 27 September - exactly `room_config` edit
   today, and api/test/modules/admin/groupSettings.test.ts fails if that ever
   changes. The database asks the same three (app.sets_group_settings). */
const GROUP_NAME = grant("room_config", "edit", "Changing the group's name");
const GROUP_LOGO = grant("room_config", "edit", "Changing the group's logo");
/* GST sits on Room types, so it is setup - and the accountant, who holds no
   setup grant, sets the rate too: "the accountant confirms the rate on the tax
   screen" (D21-91), and "owner, admin, GM and accountant" (D22-32). */
const GST = grant("room_config", "edit", "Setting GST", ["finance"]);

/* Prices: `rate` with `edit`, which is exactly RATE_SETTER_ROLES - the owner's
   INV-5 (owner, admin, GM, and the revenue manager of 16 September). */
const PRICE = grant("rate", "edit", "Setting a price");
const RESTRICTION = grant("rate", "edit", "Setting a stop sell or a minimum stay");
const TERMS = grant("rate", "edit", "Setting the cancellation terms");
/* A source's commission: the owner, an administrator and the GM, in the
   matrix (D22-30). */
const COMMISSION = grant("commission", "edit", "Setting a booking source's commission");

/* Laundry: its own resource (D18-8, reception and housekeeping). */
const LAUNDRY_TAKE = grant("laundry", "create", "Taking in laundry");
const LAUNDRY_CHANGE = grant("laundry", "edit", "Changing a laundry docket");
const LAUNDRY_CANCEL = grant("laundry", "cancel", "Cancelling a laundry docket");
const LAUNDRY_CHARGE = grant("laundry", "edit", "Charging laundry to a room");
const LAUNDRY_PRICE_ADD = grant("laundry", "create", "Adding to the laundry price list");
const LAUNDRY_PRICE = grant("laundry", "edit", "Changing the laundry price list");

/* The restaurant. The matrix has no resource of its own for it, so the
   website's menu decides who sees each screen: a grant, plus the restaurant's
   roles by name (src/modules/pos/nav.ts). The write asks the same, with the
   write's action - so a Viewer, who may look at the till, rings nothing up. */
const TILL = grant("payment", "create", "Ringing up an order", ["pos"]);
const DAY_END = grant("payment", "create", "Closing the restaurant's day", ["pos", "kitchen_manager"]);
const PASS = grant("payment", "create", "Moving a dish along at the pass", ["chef", "kitchen_manager"]);
/* The menu has its own resource since D22-35 kept the revenue manager out of
   it: the owner, an administrator, the GM and the kitchen manager. */
const MENU = grant("menu", "edit", "Changing the menu");
/* Restaurant setup (D22-6): the restaurant's name, its sections and tables -
   the owner, an administrator and the GM, the people who set the hotel up
   (the owner's answer, 25 September). `room_config` is exactly those three. */
const TILL_SETUP = grant("room_config", "edit", "Setting up the restaurant's tables");

/* No screen calls these two yet. A bill photographed for a purchase (§15) is
   purchasing's; where n8n copied a file is an integration's. */
const BILL_PHOTO = grant("purchasing", "create", "Attaching a bill");
const MIRROR = grant("integration", "edit", "Recording where a file was copied");

/* ── Every write the staff API mounts ──────────────────────────────── */

const H = "/api/hotels/:code";

export const WRITE_RULES: Readonly<Record<string, Rule>> = {
  /* The core */
  [`POST ${H}/approvals/:id/:decision`]: own("routes/approvals.ts: the request's approver role"),
  [`PUT ${H}/approval-rules/:kind`]: own("routes/approvals.ts: the owner only"),
  [`POST ${H}/places`]: own("routes/places.ts: keepsPlaces"),
  [`PUT ${H}/places/:id`]: own("routes/places.ts: keepsPlaces"),
  [`POST ${H}/suppliers`]: own("routes/places.ts: keepsPlaces"),
  [`PUT ${H}/suppliers/:id`]: own("routes/places.ts: keepsPlaces"),
  [`POST ${H}/stays/:id/guest-link`]: GUEST_PAGE,
  [`POST ${H}/online-checkin/submissions/:id/confirm`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/submissions/:id/set-aside`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/requests/:id`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/rooms/:roomId/card`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/cards`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/attachments`]: BILL_PHOTO,
  [`POST ${H}/attachments/:id/mirrored`]: MIRROR,

  /* front-desk */
  [`POST ${H}/stays/:id/check-in`]: CHECK_IN,
  [`POST ${H}/stays/:id/check-out`]: CHECK_OUT,
  [`POST ${H}/walk-ins`]: WALK_IN,
  [`POST ${H}/stays/:id/assign`]: ROOMING,
  [`POST ${H}/stays/:id/move`]: ROOMING,
  [`PATCH ${H}/stays/:id`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/unassign`]: ROOMING,
  [`POST ${H}/stays/:id/void`]: VOID,
  [`POST ${H}/stays/:id/exchange`]: ROOMING,
  /* The hotel's list of inclusions carries a default price; no screen adds
     to it yet. */
  [`POST ${H}/inclusions`]: PRICE,
  [`POST ${H}/stays/:id/inclusions`]: CHANGE_BOOKING,
  [`DELETE ${H}/stays/:id/inclusions/:lineId`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/whatsapp`]: GUEST,

  /* reservations */
  [`POST ${H}/groups/:id/master`]: CHARGE,
  /* Who leads a group - who gets its one confirmation and its one review
     request (D22-52, D22-10) - is a change to the booking. */
  [`POST ${H}/groups/:id/lead`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/routing`]: CHANGE_BILL,
  [`POST ${H}/bookings`]: BOOK,
  /* Phase 1 (the owner, 27 Sep): whoever may make a booking confirms one that
     was waiting for the hotel, and sends its one voucher (D27-35). The two
     lists are kept by the owner, an administrator or the GM - asked in
     reservations/desk.ts. */
  [`POST ${H}/stays/:id/confirm`]: grant("reservation", "create", "Confirming a booking"),
  /* D27-64: a booking waiting for the hotel is cancelled by whoever may
     cancel a booking - the same grant as the void. */
  [`POST ${H}/stays/:id/cancel`]: grant("reservation", "cancel", "Cancelling a booking"),
  [`POST ${H}/stays/:id/confirmation`]: grant("reservation", "create", "Sending a booking's voucher"),
  [`PUT ${H}/sales-people`]: own("reservations/desk.ts: owner, admin, GM"),
  [`PUT ${H}/room-promotions`]: own("reservations/desk.ts: owner, admin, GM"),

  /* finance */
  [`POST ${H}/stays/:id/folios`]: CHARGE,
  [`POST ${H}/postings/:id/transfer`]: CHANGE_BILL,
  [`POST ${H}/stays/:id/charges`]: CHARGE,
  [`POST ${H}/stays/:id/charges/:postingId/reverse`]: CHANGE_BILL,
  [`POST ${H}/stays/:id/payments`]: PAYMENT,
  [`POST ${H}/cashier-shift/open`]: DRAWER,
  [`POST ${H}/cashier-shift/movements`]: DRAWER,
  [`POST ${H}/cashier-shift/count`]: DRAWER,
  [`POST ${H}/cashier-shift/close`]: DRAWER,
  [`POST ${H}/stays/:id/invoice`]: TAX_INVOICE,
  [`POST ${H}/invoices/:number{.+}/credit-note`]: CREDIT_NOTE,
  [`POST ${H}/vat-bills/:number{.+}/cancel`]: VAT_CANCEL,
  [`PUT ${H}/tax/:kind`]: GST,
  [`PATCH ${H}/menu-categories/:name/tax-kind`]: GST,

  /* guests */
  [`POST ${H}/guests/:id/vip`]: GUEST,
  [`POST ${H}/form-c/:reservationId`]: FORM_C,
  [`PUT ${H}/form-c/:reservationId/details`]: FORM_C,
  [`POST ${H}/booking-sources`]: own("guests/bookingSources.ts: the database, app.is_manager"),
  [`PATCH ${H}/booking-sources/:id`]: own("guests/bookingSources.ts: the database, app.is_manager"),
  [`PUT ${H}/booking-sources/:id/commission`]: COMMISSION,
  [`POST ${H}/crm/joins`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/joins/:id/undo`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/not-same`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/not-same/:id/undo`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/guests/:id/blacklist`]: own("guests/people.ts: app.is_crm_manager"),
  [`DELETE ${H}/crm/guests/:id/blacklist`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/no-offers`]: own("guests/people.ts: app.is_crm_manager"),
  [`DELETE ${H}/crm/no-offers/:id`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/offers-yes`]: own("guests/people.ts: app.is_crm_manager"),

  /* night-audit */
  [`POST ${H}/night-audit/run`]: CLOSE_DAY,
  [`POST ${H}/night-audit/days/:date/corrections`]: CORRECT_DAY,

  /* pos: the menu */
  [`POST ${H}/till/menu/categories`]: MENU,
  [`POST ${H}/till/menu/items`]: MENU,
  [`POST ${H}/till/menu/import`]: MENU,
  [`POST ${H}/till/menu/items/:id/course`]: MENU,
  [`POST ${H}/till/menu/categories/:id/course`]: MENU,
  [`POST ${H}/till/menu/items/:id/prep`]: MENU,
  [`POST ${H}/till/menu/categories/:id/prep`]: MENU,
  /* A section's tax heading on the Menu screen (D22-4): the menu's, as the
     import that also sets it. The tax card's own picker stays GST. */
  [`POST ${H}/till/menu/categories/:id/tax-kind`]: MENU,
  [`POST ${H}/till/menu/items/:id/toggle`]: MENU,
  [`POST ${H}/till/menu/items/:id/variations`]: MENU,
  [`PATCH ${H}/till/menu/variations/:id`]: MENU,
  [`POST ${H}/till/menu/variations/:id/remove`]: MENU,
  [`POST ${H}/till/menu/addon-groups`]: MENU,
  [`PATCH ${H}/till/menu/addon-groups/:id`]: MENU,
  [`POST ${H}/till/menu/addon-groups/:id/dishes`]: MENU,
  [`POST ${H}/till/menu/addon-groups/:id/addons`]: MENU,
  [`PATCH ${H}/till/menu/addons/:id`]: MENU,
  [`POST ${H}/till/menu/addons/:id/remove`]: MENU,
  [`POST ${H}/till/menu/addon-groups/import`]: MENU,
  [`POST ${H}/till/promotions`]: MENU,
  [`PATCH ${H}/till/promotions/:id`]: MENU,
  /* Off and back on ("out of onions until eight") is pressed on the Menu. */
  [`POST ${H}/till/menu/items/:id/off`]: MENU,
  [`POST ${H}/till/menu/items/:id/on`]: MENU,
  [`POST ${H}/till/addons/:id/off`]: MENU,
  [`POST ${H}/till/addons/:id/on`]: MENU,
  /* pos: service */
  [`POST ${H}/till/orders`]: TILL,
  [`POST ${H}/till/orders/:id/lines`]: TILL,
  [`POST ${H}/till/orders/:id/lines/:lineId/void`]: TILL,
  [`POST ${H}/till/orders/:id/discount`]: TILL,
  [`POST ${H}/till/orders/:id/promotion`]: TILL,
  [`POST ${H}/till/orders/:id/discount/clear`]: TILL,
  [`POST ${H}/till/orders/:id/round-off`]: TILL,
  [`POST ${H}/till/outlet/:outlet/closed`]: TILL,
  [`POST ${H}/till/orders/:id/printed`]: TILL,
  [`POST ${H}/till/orders/:id/clear`]: TILL,
  [`PATCH ${H}/till/orders/:id`]: TILL,
  [`POST ${H}/till/orders/:id/settle`]: TILL,
  [`POST ${H}/till/orders/:id/abandon`]: TILL,
  [`POST ${H}/till/orders/:id/lines/:lineId/qty`]: TILL,
  [`POST ${H}/till/orders/batch`]: TILL,
  [`POST ${H}/till/orders/:id/kot`]: TILL,
  [`POST ${H}/till/day-end/movements`]: DAY_END,
  [`POST ${H}/till/day-end/count`]: DAY_END,
  [`POST ${H}/till/day-end/close`]: DAY_END,
  /* pos: restaurant setup */
  [`POST ${H}/till/setup/restaurant`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections`]: TILL_SETUP,
  [`PATCH ${H}/till/setup/sections/:id`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections/:id/off`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections/:id/tables`]: TILL_SETUP,
  [`PATCH ${H}/till/setup/tables/:id`]: TILL_SETUP,
  [`POST ${H}/till/setup/tables/:id/off`]: TILL_SETUP,
  [`POST ${H}/kitchen/lines/:lineId/:to`]: PASS,

  /* admin */
  [`POST ${H}/modules/:module`]: own("admin/moduleSwitches.ts: the owner or an administrator"),
  [`POST /api/admin/hotels`]: own("admin/admin.ts: a group administrator, with the provisioning key"),
  [`PATCH /api/admin/hotels/:code`]: own("admin/admin.ts: a group administrator"),
  [`PUT ${H}/fssai`]: FSSAI,
  [`PUT ${H}/group/name`]: GROUP_NAME,
  [`PUT ${H}/group/logo`]: GROUP_LOGO,
  [`DELETE ${H}/group/logo`]: GROUP_LOGO,
  [`POST /api/admin/hotels/:code/:state`]: own("admin/admin.ts: a group administrator"),
  [`PATCH /api/admin/staff/:id`]: own("admin/admin.ts: app.manages_person (D22-3)"),
  [`PUT /api/admin/staff/:id/home-screen`]: own("admin/admin.ts: app.set_home_screen asks app.may_manage_person"),
  [`PUT /api/me/preferences`]: SELF,
  [`POST /api/admin/staff/:id/reactivate`]: own("admin/admin.ts: app.may_switch_person (D22-3)"),
  [`POST /api/admin/staff`]: own("admin/admin.ts: app.require_hotel_admin and the grantable roles (D22-2)"),
  [`POST /api/admin/staff/:id/password`]: own("admin/admin.ts: app.may_set_password"),
  [`POST /api/admin/staff/:id/access`]: own("admin/admin.ts: app.require_hotel_admin and the grantable roles"),
  [`DELETE /api/admin/staff/:id/access/:code`]: own("admin/admin.ts: app.require_hotel_admin"),
  [`POST /api/admin/staff/:id/deactivate`]: own("admin/admin.ts: app.may_switch_person (D22-3)"),

  /* inventory */
  [`PUT ${H}/room-types/:id/rate`]: PRICE,
  [`POST ${H}/rate-plans`]: PRICE,
  [`DELETE ${H}/rate-plans/:id`]: PRICE,
  [`POST ${H}/cancellation-policies`]: TERMS,
  [`DELETE ${H}/cancellation-policies/:id`]: TERMS,
  [`PUT ${H}/cancellation-policies/:id/default`]: TERMS,
  [`PUT ${H}/rate-grid`]: own("inventory/rateSetters.ts: RATE_SETTER_ROLES (INV-5)"),
  [`POST ${H}/restrictions`]: RESTRICTION,
  [`PUT ${H}/pricing/basis`]: PRICE,
  [`PUT ${H}/pricing/base`]: PRICE,
  [`PUT ${H}/pricing/offset`]: PRICE,
  [`POST ${H}/room-types`]: SETUP_ADD,
  [`PATCH ${H}/room-types/:id`]: SETUP_CHANGE,
  [`POST ${H}/rooms`]: SETUP_ADD,
  [`PATCH ${H}/rooms/:number`]: SETUP_CHANGE,
  /* The front desk's hours and its early and late charges: setup. */
  [`PATCH ${H}/front-desk`]: SETUP_CHANGE,
  [`POST ${H}/room-types/import`]: SETUP_ADD,
  [`POST ${H}/rooms/import`]: SETUP_ADD,

  /* banquet */
  [`POST ${H}/banquet/events`]: FUNCTION_BOOK,
  [`POST ${H}/banquet/events/:id/confirm`]: FUNCTION_CHANGE,
  [`POST ${H}/banquet/events/:id/cancel`]: FUNCTION_CANCEL,
  [`PATCH ${H}/banquet/events/:id`]: FUNCTION_CHANGE,
  [`POST ${H}/banquet/events/:id/catering`]: FUNCTION_CHANGE,
  [`DELETE ${H}/banquet/events/:id/catering/:lineId`]: FUNCTION_CHANGE,
  /* Round E (BQ-1): a function's bill. */
  [`POST ${H}/banquet/events/:id/bill`]: FUNCTION_MONEY,
  [`POST ${H}/banquet/events/:id/payments`]: FUNCTION_MONEY,
  [`POST ${H}/banquet/events/:id/invoice`]: FUNCTION_INVOICE,
  [`POST ${H}/banquet/venues`]: HALLS,
  [`PATCH ${H}/banquet/venues/:id`]: HALLS,
  [`POST ${H}/banquet/packages`]: HALLS,

  /* stores */
  [`POST ${H}/stores/items`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/movements`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/movements/:id/reverse`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/transfers`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/import`]: own("stores/stockGrants.ts"),
  [`PATCH ${H}/stores/items/:id`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/counts`]: own("stores/stockGrants.ts"),

  /* housekeeping */
  [`PUT ${H}/rooms/:number/housekeeping`]: ROOM_STATE,
  [`POST ${H}/rooms/:number/block`]: OUT_OF_SERVICE,
  [`DELETE ${H}/rooms/:number/block/:id`]: OUT_OF_SERVICE,
  [`PUT ${H}/housekeeping/assignments/:number`]: HOUSEKEEPING_ROUNDS,
  [`DELETE ${H}/housekeeping/assignments/:number`]: HOUSEKEEPING_ROUNDS,
  /* A repair on equipment asks REPAIR_REPORTERS; any other repair, and every
     update, asks REPAIR_UPDATERS (D22-34). The route decides, because only
     the body says whether a repair names a piece of equipment. */
  [`POST ${H}/work-orders`]: own("housekeeping/repairRoles.ts: REPAIR_REPORTERS for equipment, REPAIR_UPDATERS for the rest"),
  [`PATCH ${H}/work-orders/:id`]: own("housekeeping/repairRoles.ts: REPAIR_UPDATERS"),
  [`POST ${H}/repair-costs`]: own("housekeeping/repairRoles.ts: COST_RECORDERS"),
  [`POST ${H}/repair-costs/:id/cancel`]: own("housekeeping/repairRoles.ts: COST_RECORDERS"),

  /* equipment */
  [`POST ${H}/equipment`]: own("equipment/grants.ts"),
  [`PATCH ${H}/equipment/items/:id`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/move`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/status`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/retire`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/import`]: own("equipment/grants.ts"),

  /* channel-manager */
  [`POST /api/channel-manager/su/login`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/hotel`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/room-types/:roomTypeId`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/rate-plans/:mealPlan`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/content/send`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/availability/send`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/bookings/:id/done`]: own("channel-manager/access.ts"),

  /* purchasing */
  [`PUT ${H}/purchasing/requesters/:role`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests`]: own("purchasing/purchasingGrants.ts"),
  [`PUT ${H}/purchasing/requests/:id/lines/:lineId`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/order`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/cancel`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/delivery`]: own("purchasing/purchasingGrants.ts"),

  /* laundry */
  [`POST ${H}/laundry/price-list`]: LAUNDRY_PRICE_ADD,
  [`POST ${H}/laundry/price-list/:id`]: LAUNDRY_PRICE,
  [`POST ${H}/laundry/dockets`]: LAUNDRY_TAKE,
  [`POST ${H}/laundry/dockets/:id/return`]: LAUNDRY_CHANGE,
  [`POST ${H}/laundry/dockets/:id/cancel`]: LAUNDRY_CANCEL,
  [`POST ${H}/laundry/dockets/:id/charge`]: LAUNDRY_CHARGE,

  /* spa */
  [`POST ${H}/spa/treatments`]: own("spa/spa.ts: its own role lists"),
  [`PATCH ${H}/spa/treatments/:id`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/therapists`]: own("spa/spa.ts: its own role lists"),
  [`PATCH ${H}/spa/therapists/:id`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments/:id/cancel`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments/:id/close`]: own("spa/spa.ts: its own role lists"),

  /* reputation */
  [`PUT ${H}/reviews/link`]: own("reputation/reputation.ts: its own role lists"),
  [`POST ${H}/reviews/:id/ask`]: own("reputation/reputation.ts: its own role lists"),
};

/* ══════════════════════════════════════════════════════════════════
   WHO MAY READ — EVERY READ ASKS THE ROLE TOO (RO-1, A7; 28 September)

   Until 28 September only Form III and online check-in asked: row security
   answered "which hotel", and nothing answered "which role", so the chef
   read the Manager report, every stay and every bill by address, and the
   owner's rules on money and guests held only because the menu hid the
   screens (QA RO-1 to RO-3; docs/SELLING-IN-INDIA.md A7).

   Now every read the server mounts has a rule, from the same matrix the
   screens use - the resource of the screens that call it, and where several
   screens share one read, any of their resources. A READ MISSING FROM HERE
   IS REFUSED FOR EVERYBODY, as a write is, and api/test/roleGate.test.ts
   names any mounted read that is not here.

   What a read gives is the matrix's own words: a stay is `reservation`, a
   bill `invoice`, money taken `payment`, a guest `customer`, a report
   `report`. The owner's answers of 28 September (D27-140 to D27-147) are
   in the matrix itself; the two that are about FIELDS rather than whole
   reads are WITHHELD, below.
   ══════════════════════════════════════════════════════════════════ */

const see = (resource: Resource | readonly Resource[], what: string, also: readonly Role[] = []) =>
  grant(resource, "view", `Reading ${what}`, also);

const STAYS = see("reservation", "bookings");
const BILLS = see("invoice", "bills");
/* D27-147: the City ledger, Guest ledger and Cashier shift reports are money
   owed and money taken, so they ask `invoice` as a bill does - the revenue
   manager, who keeps `report`, is not let in. D27-145: Company accounts'
   balances the same. */
const MONEY_REPORT = see("invoice", "money owed and taken");
const MONEY = see("payment", "payments and the cash drawer");
const GUESTS = see("customer", "guests");
const REPORTS = see("report", "reports");
const PRICES = see("rate", "prices");
const SETUP = see("room_config", "the hotel's setup");
const LAUNDRY = see("laundry", "laundry");
/* The restaurant's screens are a grant plus the till by name (pos/nav.ts). */
const TILL_READ = see("payment", "the restaurant's orders", ["pos"]);
const MENU_READ = see(["menu", "payment"], "the menu", ["pos"]);
/* The Housekeeping board, Work orders and an item's page share these. */
const REPAIRS = see(["room_config", "equipment", "inventory"], "repairs");

export const READ_RULES: Readonly<Record<string, Rule>> = {
  /* ── Every person rostered here: the shell and the room list ── */
  [`GET /api/hotels`]: own("routes/hotels.ts: the hotels this person works at"),
  [`GET ${H}`]: anyone("the property's name and business date, on every screen"),
  [`GET ${H}/modules`]: anyone("which services are on: the menu itself"),
  [`GET ${H}/live`]: anyone("a ping that something changed, with no data in it"),
  [`GET ${H}/rooms`]: anyone("room numbers and their states: nearly every screen"),
  [`GET ${H}/house-now`]: anyone("which rooms are occupied, blocked or empty - no guest"),
  [`GET ${H}/group`]: anyone("the group's name and logo, on every document"),
  [`GET ${H}/tax`]: anyone("the GST rates in use: neither a guest nor money taken"),
  [`GET ${H}/tax/:kind/rate`]: anyone("the GST rate for an amount"),
  [`GET ${H}/till/access`]: anyone("what the till lets this person do"),
  [`GET ${H}/notifications`]: see("notification", "notifications"),
  [`GET /api/admin/overview`]: anyone("counts of people and hotels, under row security"),

  /* ── Bookings and stays ── */
  [`GET ${H}/stays`]: STAYS,
  [`GET ${H}/stays/:id`]: STAYS,
  [`GET ${H}/stays/:id/exchangeable`]: STAYS,
  [`GET ${H}/stays/:id/inclusions`]: STAYS,
  [`GET ${H}/stays/:id/guest-marks`]: STAYS,
  [`GET ${H}/inclusions`]: STAYS,
  [`GET ${H}/early-arrival`]: STAYS,
  [`GET ${H}/groups`]: STAYS,
  [`GET ${H}/groups/:id`]: STAYS,
  [`GET ${H}/guests/blacklist-warnings`]: STAYS,
  [`GET ${H}/sales-people`]: STAYS,
  [`GET ${H}/room-promotions`]: STAYS,
  [`GET ${H}/banquet`]: STAYS,
  [`GET ${H}/banquet/events/:id`]: STAYS,
  [`GET ${H}/banquet/setup`]: see(["reservation", "room_config"], "the banquet halls"),
  [`GET ${H}/tariff`]: see(["reservation", "rate"], "a stay's price"),
  [`GET ${H}/inventory`]: see(["inventory", "reservation"], "availability"),
  [`GET ${H}/booking-sources`]: see(["reservation", "commission"], "booking sources"),
  [`GET ${H}/companies`]: see("company", "companies"),

  /* ── Guests (D25-38 for their ID details; D27-144 for their messages) ── */
  [`GET ${H}/guests`]: GUESTS,
  [`GET ${H}/guests/returning`]: GUESTS,
  [`GET ${H}/crm/guests`]: GUESTS,
  [`GET ${H}/crm/guests/:id`]: GUESTS,
  [`GET ${H}/crm/same-person`]: GUESTS,
  [`GET ${H}/crm/joins`]: GUESTS,
  [`GET ${H}/crm/not-same`]: GUESTS,
  [`GET ${H}/crm/offers-yes`]: GUESTS,
  [`GET ${H}/crm/no-offers`]: GUESTS,
  [`GET ${H}/form-c`]: GUEST_ID,
  [`GET ${H}/reports/c-form`]: GUEST_ID,
  /* The details guests sent from their own page: asked in the route. */
  [`GET ${H}/online-checkin`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`GET ${H}/online-checkin/messages`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`GET ${H}/guest-messages`]: own("guest-messaging/messages.ts: VIEW_ROLES, `customer` view (D27-144)"),
  [`GET ${H}/reviews`]: own("reputation/reputation.ts: VIEW_ROLES"),

  /* ── Bills and money (D27-143) ── */
  [`GET ${H}/folios`]: BILLS,
  [`GET ${H}/stays/:id/bill`]: BILLS,
  [`GET ${H}/stays/:id/folio`]: BILLS,
  [`GET ${H}/stays/:id/folios`]: BILLS,
  [`GET ${H}/stays/:id/postings`]: BILLS,
  [`GET ${H}/billable`]: BILLS,
  [`GET ${H}/billing-companies`]: BILLS,
  [`GET ${H}/invoices`]: BILLS,
  [`GET ${H}/invoices/:number{.+}`]: BILLS,
  [`GET ${H}/vat-bills`]: BILLS,
  [`GET ${H}/vat-bills/:number{.+}`]: BILLS,
  [`GET ${H}/invoice-series`]: see(["invoice", "setting"], "the invoice numbers"),
  [`GET ${H}/pos/tickets`]: BILLS,
  [`GET ${H}/pos/outlets`]: see(["payment", "invoice", "setting"], "the restaurant's outlets", ["pos"]),
  [`GET ${H}/payments`]: MONEY,
  [`GET ${H}/cashier-shift`]: MONEY,
  [`GET ${H}/accounting/:file{day-book(?:\\.xlsx)?}`]: own("accounting/routes.ts: MAY_EXPORT (D27-122)"),

  /* ── Reports ── */
  [`GET ${H}/reports/manager`]: REPORTS,
  [`GET ${H}/reports/night-audit`]: REPORTS,
  [`GET ${H}/reports/no-show`]: REPORTS,
  [`GET ${H}/reports/monthly-occupancy`]: REPORTS,
  [`GET ${H}/reports/monthly-statistics`]: REPORTS,
  [`GET ${H}/reports/yearly-statistics`]: REPORTS,
  [`GET ${H}/reports/lodging-tax`]: REPORTS,
  [`GET ${H}/reports/gst-sales`]: REPORTS,
  [`GET ${H}/reports/city-ledger`]: MONEY_REPORT,
  [`GET ${H}/reports/guest-ledger`]: MONEY_REPORT,
  [`GET ${H}/reports/cashier-shift`]: MONEY_REPORT,
  [`GET ${H}/reports/balances-by-source`]: MONEY_REPORT,
  [`GET ${H}/reports/:file{[a-z0-9-]+\\.(?:pdf|xlsx|csv)}`]: own("routes/reportFiles.ts: REPORT_EXPORTERS, and `invoice` for the money reports"),
  [`GET ${H}/statistics/daily`]: see(["report", "rate"], "occupancy and ADR"),
  [`GET ${H}/statistics/period`]: see(["report", "rate"], "occupancy and ADR"),
  [`GET ${H}/statistics/snapshot`]: see(["report", "rate"], "occupancy and ADR"),
  [`GET ${H}/revenue/pickup`]: PRICES,
  [`GET ${H}/night-audit`]: REPORTS,
  [`GET ${H}/night-audit/runs`]: REPORTS,
  [`GET ${H}/night-audit/days/:date/charges`]: REPORTS,

  /* ── Rooms, rates and setup ── */
  [`GET ${H}/pricing`]: PRICES,
  [`GET ${H}/rates`]: PRICES,
  [`GET ${H}/rate-grid`]: PRICES,
  [`GET ${H}/rate-plans`]: PRICES,
  [`GET ${H}/cancellation-policies`]: PRICES,
  [`GET ${H}/room-types`]: see(["room_config", "rate", "reservation"], "room types"),
  [`GET ${H}/room-setup`]: SETUP,
  [`GET ${H}/commissioning`]: SETUP,
  [`GET ${H}/till/setup`]: SETUP,
  [`GET ${H}/housekeepers`]: see("inventory", "who cleans which room"),
  [`GET ${H}/housekeeping/assignments`]: see("inventory", "who cleans which room"),
  [`GET ${H}/work-orders`]: REPAIRS,
  [`GET ${H}/repairable-equipment`]: REPAIRS,

  /* ── The restaurant ── */
  [`GET ${H}/till/menu`]: MENU_READ,
  [`GET ${H}/till/menu/addon-groups`]: MENU_READ,
  [`GET ${H}/till/promotions`]: MENU_READ,
  [`GET ${H}/till/orders`]: TILL_READ,
  [`GET ${H}/till/orders/:id`]: TILL_READ,
  [`GET ${H}/till/orders/:id/kot/:no`]: TILL_READ,
  [`GET ${H}/till/floor`]: TILL_READ,
  [`GET ${H}/till/rooms`]: TILL_READ,
  [`GET ${H}/till/waiters`]: TILL_READ,
  [`GET ${H}/banquet/attachable`]: TILL_READ,
  [`GET ${H}/till/day-end`]: see("payment", "the restaurant's day", ["pos", "kitchen_manager"]),
  [`GET ${H}/kitchen`]: see("payment", "the kitchen's queue", ["chef", "kitchen_manager"]),

  /* ── Store, equipment, purchasing, places ── */
  [`GET ${H}/stores`]: own("stores/stockGrants.ts: mayStock"),
  [`GET ${H}/stores/items/:id/movements`]: own("stores/stockGrants.ts: mayStock"),
  [`GET ${H}/equipment`]: own("equipment/grants.ts"),
  [`GET ${H}/equipment/items/:id`]: own("equipment/grants.ts"),
  [`GET ${H}/equipment/export`]: own("equipment/grants.ts"),
  [`GET ${H}/equipment/options`]: see("equipment", "the equipment register"),
  [`GET ${H}/purchasing`]: own("purchasing/purchasingGrants.ts: VIEW_ROLES"),
  [`GET ${H}/purchasing/requests/:id`]: own("purchasing/purchasingGrants.ts: VIEW_ROLES"),
  [`GET ${H}/purchasing/requesters`]: own("purchasing/purchasingGrants.ts: VIEW_ROLES"),
  [`GET ${H}/purchasing/orders/:file{[0-9a-f-]+\\.pdf}`]: own("purchasing/purchasingGrants.ts: VIEW_ROLES"),
  [`GET ${H}/places`]: see(["stock", "equipment", "purchasing"], "places and suppliers"),
  [`GET ${H}/approvals`]: see(["notification", "equipment", "purchasing"], "approvals"),
  [`GET ${H}/approval-rules`]: see("setting", "who approves what"),
  [`GET ${H}/attachments`]: see(["purchasing", "equipment", "room_config"], "attached files"),
  [`GET ${H}/attachments/:id/file`]: see(["purchasing", "equipment", "room_config"], "attached files"),
  /* n8n's queue of bills to copy: an integration's. */
  [`GET ${H}/attachments/awaiting-mirror`]: see("integration", "the files waiting to be copied"),

  /* ── Laundry and spa ── */
  [`GET ${H}/laundry/dockets`]: LAUNDRY,
  [`GET ${H}/laundry/dockets/:id`]: LAUNDRY,
  [`GET ${H}/laundry/price-list`]: LAUNDRY,
  [`GET ${H}/spa`]: own("spa/spa.ts: SPA_READ_ROLES"),
  [`GET ${H}/spa/treatments`]: own("spa/spa.ts: SPA_READ_ROLES"),
  [`GET ${H}/spa/therapists`]: own("spa/spa.ts: SPA_READ_ROLES"),

  /* ── Channel manager ── */
  [`GET /api/channel-manager/su`]: own("channel-manager/connection.ts: maySetUpSu"),
  [`GET ${H}/channel-manager/content`]: own("channel-manager/access.ts"),
  [`GET ${H}/channel-manager/availability`]: own("channel-manager/access.ts"),
  [`GET ${H}/channel-manager/bookings`]: own("channel-manager/access.ts"),

  /* ── Administration ── */
  [`GET /api/admin/hotels`]: own("admin/admin.ts: a group administrator"),
  [`GET /api/admin/hotels/:code`]: own("admin/admin.ts: app.require_hotel_admin"),
  [`GET /api/admin/staff`]: own("admin/admin.ts: row security on staff, app.may_manage_person"),
  [`GET ${H}/staff`]: see("user", "the staff list"),
  [`GET ${H}/audit-log`]: own("admin/adminLists.ts: mayRead"),
  [`GET ${H}/settings`]: own("admin/adminLists.ts: mayRead"),
  /* D27-91: the server's health, for the owner and an administrator. */
  [`GET ${H}/system-health`]: SYSTEM_HEALTH,
};

/* ── What a read withholds (D27-143) ─────────────────────────────────
   The owner's answer for the roles that read bookings but not bills or
   guests (the revenue manager, housekeeping, the kitchen manager, the till):
   they still see bookings, rooms and dates, but a guest's phone and email
   come back blank and a group's balances are not sent. The route answers as
   it always did; the gate blanks these keys, at any depth, for a role
   without `view` on `unless`. Null, not absent: null is what these fields
   already say when there is nothing to show. */
export const WITHHELD: Readonly<Record<string, { keys: readonly string[]; unless: Resource }>> = {
  [`GET ${H}/stays`]: { keys: ["phone", "email"], unless: "customer" },
  [`GET ${H}/stays/:id`]: { keys: ["phone", "email"], unless: "customer" },
  [`GET ${H}/groups`]: { keys: ["masterBalance", "guestBalance"], unless: "invoice" },
  [`GET ${H}/groups/:id`]: { keys: ["balance", "guestBalance", "master"], unless: "invoice" },
};

const blank = (value: unknown, keys: readonly string[]): unknown =>
  Array.isArray(value) ? value.map((v) => blank(v, keys))
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([k, v]) =>
        [k, keys.includes(k) ? null : blank(v, keys)]))
      : value;

/** The prefixes server.ts lets through with no person behind them. */
export const DOORS = ["/api/guest", "/api/pos", "/api/channel"] as const;

export const isDoor = (path: string): boolean =>
  DOORS.some((door) => path === door || path.startsWith(`${door}/`));

/* ── The sentence ──────────────────────────────────────────────────── */

/* How each role is named when a refusal says who may. The equipment
   register's words (equipment/grants.ts), which the owner has read. */
const WHO: Readonly<Record<Role, string>> = {
  owner: "the owner",
  admin: "an administrator",
  gm: "the general manager",
  hotel_manager: "the hotel manager",
  revenue_manager: "the revenue manager",
  front_desk: "reception",
  housekeeping: "housekeeping",
  kitchen_manager: "the kitchen manager",
  chef: "a chef",
  pos: "a till operator",
  stores: "the Inventory Manager",
  finance: "the accountant",
  read_only: "a viewer",
  automation: "an automation account",
};

/** May this role do what the rule says? */
export function allows(rule: Rule, role: Role): boolean {
  switch (rule.kind) {
    case "grant":
      return ([] as Resource[]).concat(rule.resource).some((r) => can(role, rule.action, r))
        || rule.also.includes(role);
    case "own": case "self": case "anyone": return true;
  }
}

/** The people a rule lets in, in the matrix's order. Never the automation account. */
export const whoMay = (rule: Rule): Role[] =>
  ROLES.filter((role) => role !== "automation" && allows(rule, role));

const list = (names: string[]): string =>
  names.length <= 1 ? names.join("")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

/** What a refused person reads: what they tried, and whom to ask. */
export function refusalFor(rule: Rule): string {
  if (rule.kind !== "grant") return "";
  return `${rule.doing} is for ${list(whoMay(rule).map((r) => WHO[r]))}. Ask one of them.`;
}

export const UNMAPPED =
  "Nobody has been given this yet. Ask the owner which roles may do it.";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ── The gate ──────────────────────────────────────────────────────── */

export const roleGate: MiddlewareHandler<{ Variables: { subject: string } }> = async (c, next) => {
  const write = WRITES.has(c.req.method);
  if (!write && c.req.method !== "GET") return next();

  /* The route that will answer: the first one matched for this method. Hono
     lists middleware too (method ALL), which is why the method is compared. */
  const route = matchedRoutes(c).find((r) => r.method === c.req.method);
  if (!route || isDoor(route.path)) return next();

  const key = `${route.method} ${route.path}`;
  const rule = write ? WRITE_RULES[key] : READ_RULES[key];
  /* A read nobody mapped is refused too, since 28 September (RO-1). */
  if (!rule) return c.json({ ok: false, reason: UNMAPPED }, 403);
  if (rule.kind !== "grant") return next();

  /* Every grant rule is a /api/hotels/:code route (the guard test
     holds them to it), so the fourth segment is the hotel. */
  const code = decodeURIComponent(c.req.path.split("/")[3] ?? "").toUpperCase();
  const role = await withSession(c.get("subject"), async (client, session) => {
    if (session.isGroupAdmin) return "owner";
    const { rows } = await client.query<{ role: string }>(
      `select sh.role from staff_hotels sh
         join hotels h on h.id = sh.hotel_id
        where sh.staff_id = $1 and h.code = $2`,
      [session.staffId, code]);
    return rows[0]?.role ?? null;
  });

  /* Not rostered here, or no such hotel: the route says "No such property",
     as it always has. */
  if (role === null) return next();
  if (!allows(rule, role as Role)) return c.json({ ok: false, reason: refusalFor(rule) }, 403);

  const withheld = write ? undefined : WITHHELD[key];
  if (!withheld || can(role as Role, "view", withheld.unless)) return next();
  await next();
  if (!c.res.headers.get("content-type")?.includes("application/json")) return;
  const { status } = c.res;
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  const body = blank(await c.res.json(), withheld.keys);
  /* Undefined first: Hono copies the old response's headers onto a new
     one, and the old content-length would cut the new body short. */
  c.res = undefined;
  c.res = new Response(JSON.stringify(body), { status, headers });
};
